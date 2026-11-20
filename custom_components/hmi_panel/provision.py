"""Explicit, administrator-initiated Android provisioning over classic TCP ADB.

No discovery, polling, account removal, factory reset or arbitrary shell API.
The PIN and Home Assistant login are entered on the panel, never sent here.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import time
from urllib.parse import parse_qs, urlsplit

PACKAGE = "local.home.hmi"
ADMIN = PACKAGE + "/.PanelAdmin"
REMOTE_APK = "/data/local/tmp/home-panel-kiosk.apk"
APK_DIRECTORY = Path(__file__).parent / "kiosk"


class ProvisionError(Exception):
    """A safe, actionable error suitable for the administrator UI."""

    def __init__(self, code, message, steps=None):
        super().__init__(message)
        self.code, self.steps = code, steps or []


def validate_address(host, port=5555):
    """Accept a single private unicast IP, not URLs, DNS or shell fragments."""
    try:
        address = ipaddress.ip_address(host.strip())
    except (ValueError, AttributeError) as err:
        raise ProvisionError("invalid_host", "Укажите IP-адрес панели в локальной сети.") from err
    if not address.is_private or any((address.is_loopback, address.is_unspecified,
                                      address.is_multicast, address.is_link_local)):
        raise ProvisionError("invalid_host", "Нужен локальный IP панели, не адрес Интернета или самого HA.")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ProvisionError("invalid_port", "Порт ADB должен быть числом от 1 до 65535.")
    return str(address), port


def validate_url(value):
    """Dashboard URL with no embedded credentials or authentication query."""
    if not isinstance(value, str) or len(value) > 2048 or any(c.isspace() for c in value.strip()):
        raise ProvisionError("invalid_url", "Укажите полный адрес дашборда HA.")
    value = value.strip()
    try:
        uri = urlsplit(value)
        port = uri.port
        valid = (uri.scheme in ("http", "https") and uri.hostname
                 and uri.username is None and uri.password is None
                 and (port is None or 1 <= port <= 65535)
                 and not {k.lower() for k in parse_qs(uri.query)}.intersection(
                     {"auth", "token", "access_token", "password", "code"}))
    except ValueError:
        valid = False
    if not valid:
        raise ProvisionError("invalid_url", "Нужен http:// или https:// адрес без логина, пароля и токенов.")
    return value


def connect_device(host, port, key_path):
    """Runs in an executor. RSA keys are local to this HA installation."""
    from adb_shell.adb_device import AdbDeviceTcp
    from adb_shell.auth.keygen import keygen
    from adb_shell.auth.sign_pythonrsa import PythonRSASigner

    key_path = Path(key_path)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if not key_path.exists():
        # Reserve with restrictive permissions before the library writes the key.
        descriptor = os.open(key_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        try:
            keygen(str(key_path))
            public_path = Path(str(key_path) + ".pub")
            public_key = public_path.read_text(encoding="utf-8").split()[0]
            public_path.write_text(public_key + " home-panel@home-assistant\n", encoding="utf-8")
        except Exception:
            key_path.unlink(missing_ok=True)
            raise
    os.chmod(key_path, 0o600)
    signer = PythonRSASigner.FromRSAKeyPath(str(key_path))
    device = AdbDeviceTcp(host, port, default_transport_timeout_s=5, banner="home-panel")
    try:
        connected = device.connect(rsa_keys=[signer], auth_timeout_s=15, read_timeout_s=15)
        if not connected:
            raise ProvisionError("adb_auth", "Подтвердите разрешение отладки на экране Android и повторите проверку.")
        return device
    except Exception:
        device.close()
        raise


def shell(device, command, timeout=15):
    """Only callers in this module construct shell commands."""
    return device.shell(command, transport_timeout_s=5, read_timeout_s=timeout, timeout_s=timeout)


def device_info(device):
    properties = {}
    for name, prop in (("model", "ro.product.model"), ("manufacturer", "ro.product.manufacturer"),
                       ("android", "ro.build.version.release"), ("sdk", "ro.build.version.sdk"),
                       ("identity", "ro.serialno")):
        properties[name] = shell(device, "getprop " + prop).strip()[:160]
    try:
        properties["sdk"] = int(properties["sdk"])
    except ValueError as err:
        raise ProvisionError("invalid_device", "Устройство не сообщило версию Android SDK.") from err
    policy = shell(device, "dumpsys device_policy")
    owner = None
    if match := re.search(r"Device Owner:\s*\n(.*?)(?=\n[^ \t\n]|\Z)", policy, re.S):
        if component := re.search(r"(?:admin=)?ComponentInfo\{([^}]+)\}", match[1]):
            owner = component[1]
    properties["device_owner"] = owner
    identity = properties["identity"].lower()
    if identity in ("unknown", "none", "null") or not identity.strip("0"):
        properties["identity"] = ""
    package = shell(device, "dumpsys package " + PACKAGE)
    version = re.search(r"versionName=([^\s]+)", package)
    properties["installed_version"] = version[1] if version else None
    return properties


def bundled_apk():
    metadata = json.loads((APK_DIRECTORY / "manifest.json").read_text(encoding="utf-8"))
    apk = APK_DIRECTORY / "hmi-kiosk.apk"
    if hashlib.sha256(apk.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ProvisionError("apk_corrupt", "APK в интеграции повреждён. Переустановите интеграцию из репозитория.")
    return apk, metadata


def install_on_device(device, url, full_kiosk, expected_identity):
    """Fixed sequence. Existing data stays in place; no downgrade or uninstall."""
    steps = []
    uploaded = False
    try:
        info = device_info(device)
        if info["identity"] != expected_identity:
            raise ProvisionError("device_changed", "По этому IP теперь другое устройство. Повторите проверку.")
        apk, metadata = bundled_apk()
        if info["sdk"] < metadata["min_sdk"]:
            raise ProvisionError("android_too_old", "Для приложения нужен Android 8 или новее.")
        if full_kiosk and info["device_owner"] and not info["device_owner"].startswith(PACKAGE + "/"):
            raise ProvisionError("another_owner", "У устройства уже есть другой владелец. Мастер его не меняет.")
        uploaded = True
        device.push(str(apk), REMOTE_APK, st_mode=0o100644, transport_timeout_s=5, read_timeout_s=30)
        steps.append("APK скопирован во временный каталог панели")
        installed = shell(device, "pm install -t -r " + REMOTE_APK, timeout=60)
        if not re.search(r"\bSuccess\b", installed):
            if "UPDATE_INCOMPATIBLE" in installed:
                message = "Установленная копия подписана другим ключом. Данные не удалялись; автоматической замены нет."
            elif "VERSION_DOWNGRADE" in installed:
                message = "На панели более новая версия. Понижение версии отключено."
            else:
                message = "Android отклонил установку APK. Проверьте ограничения установки на панели."
            raise ProvisionError("install_failed", message)
        steps.append("Приложение установлено с сохранением его данных")
        if full_kiosk and not info["device_owner"]:
            owner_result = shell(device, "dpm set-device-owner " + ADMIN, timeout=30)
            if "Success" not in owner_result:
                raise ProvisionError("owner_failed", "Приложение установлено, но Android не разрешил назначить владельца. Мастер не удаляет аккаунты и не сбрасывает устройство.")
            steps.append("Приложение назначено владельцем выделенного устройства")
        elif full_kiosk:
            steps.append("Приложение уже является владельцем устройства")
        command = ("am broadcast -n " + PACKAGE + "/.ProvisionReceiver"
                   + " -a " + PACKAGE + ".PROVISION --es start_url " + shlex.quote(url)
                   + " --ez enable_lock " + ("true" if full_kiosk else "false"))
        configured = shell(device, command)
        if "home_panel_configured" not in configured:
            raise ProvisionError("configure_failed", "APK установлен, но Android не подтвердил сохранение адреса. Настройте адрес на панели или повторите проверку.")
        steps.append("Адрес дашборда передан приложению; PIN не передавался")
        started = shell(device, "am start -n " + PACKAGE + "/.MainActivity --ez refresh_url true")
        if "Error" in started or "Exception" in started:
            raise ProvisionError("launch_failed", "Приложение установлено и настроено, но Android не разрешил его запуск. Откройте «Дом · панель» на устройстве.")
        steps.append("Команда запуска приложения выполнена")
        return {"ok": True, "steps": steps, "version": metadata["version"],
                "pin_needed": "home_panel_configured_pin_needed" in configured,
                "full_kiosk_requested": full_kiosk}
    except ProvisionError as err:
        err.steps = steps
        raise
    except Exception as err:
        raise ProvisionError("connection_lost", "Связь с Android прервалась. Выполненные шаги показаны ниже; повторите проверку перед новой попыткой.", steps) from err
    finally:
        if uploaded:
            try:
                shell(device, "rm -f " + REMOTE_APK, timeout=5)
            except Exception:
                pass


class PanelManager:
    """Serializes operations and remembers successful panels, without secrets."""

    def __init__(self, executor, store, key_path, client_factory=connect_device):
        self.executor, self.store, self.key_path = executor, store, key_path
        self.client_factory = client_factory
        self.lock = asyncio.Lock()
        self.tickets = {}

    async def async_list(self):
        data = await self.store.async_load() or {}
        return data.get("panels", [])

    async def _connect(self, host, port):
        try:
            return await self.executor(self.client_factory, host, port, self.key_path)
        except ProvisionError:
            raise
        except Exception as err:
            if "Auth" in type(err).__name__:
                raise ProvisionError("adb_auth", "Подтвердите отладку на экране Android и повторите проверку.") from err
            raise ProvisionError("adb_unreachable", "Не удалось подключиться к ADB. Проверьте IP, порт, отладку по сети и доступ панели из HA.") from err

    async def _close(self, client):
        try:
            await self.executor(client.close)
        except Exception:
            pass

    async def async_probe(self, host, port, user_id):
        host, port = validate_address(host, port)
        async with self.lock:
            client = await self._connect(host, port)
            try:
                info = await self.executor(device_info, client)
            finally:
                await self._close(client)
            token = secrets.token_urlsafe(24)
            now = time.monotonic()
            self.tickets = {key: value for key, value in self.tickets.items() if value["expires"] > now}
            if len(self.tickets) >= 32:
                self.tickets.pop(next(iter(self.tickets)))
            identity = info.pop("identity")
            if not identity:
                raise ProvisionError("no_identity", "Android не сообщил серийный номер. Автоматическая установка отключена, чтобы не перепутать устройства.")
            self.tickets[token] = {"host": host, "port": port, "identity": identity,
                                   "user_id": user_id, "expires": now + 300}
            return {"ok": True, "host": host, "port": port, "device": info, "probe_token": token}

    async def async_install(self, host, port, url, name, full_kiosk, token, user_id):
        host, port = validate_address(host, port)
        url = validate_url(url)
        if not isinstance(full_kiosk, bool) or not isinstance(name, str) or len(name) > 80:
            raise ProvisionError("invalid_request", "Некорректное название панели или режим киоска.")
        async with self.lock:
            ticket = self.tickets.pop(token, None) if isinstance(token, str) else None
            if not ticket or ticket["expires"] < time.monotonic() or any(
                ticket[key] != value for key, value in (("host", host), ("port", port), ("user_id", user_id))
            ):
                raise ProvisionError("probe_required", "Сначала проверьте эту панель. Проверка действительна пять минут.")
            client = await self._connect(host, port)
            try:
                result = await self.executor(install_on_device, client, url, full_kiosk, ticket["identity"])
            finally:
                await self._close(client)
            records = await self.async_list()
            records = [record for record in records if (record["host"], record["port"]) != (host, port)]
            records.append({"host": host, "port": port, "url": url, "name": name,
                            "version": result["version"], "installed_at": int(time.time())})
            try:
                await self.store.async_save({"panels": records})
            except Exception:
                result["storage_warning"] = "Приложение установлено, но список панелей не удалось сохранить в HA. Повторная установка не требуется."
            return result
