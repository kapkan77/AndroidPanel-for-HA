"""Provisioning boundaries and failure recovery with an isolated fake Android."""
import copy
import json
from pathlib import Path
import shlex
import types
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import AsyncMock, Mock, patch

import test_integration  # Shared HA API doubles; no running house is contacted.
from custom_components.hmi_panel import provision
from custom_components.hmi_panel.websocket import async_manage_panel


class FakeAndroid:
    def __init__(self, profile):
        self.profile = copy.deepcopy(profile)
        self.commands, self.uploads, self.closed = [], [], False

    def shell(self, command, **kwargs):
        self.commands.append(command)
        props = {"ro.product.model": "Test Panel", "ro.product.manufacturer": "Demo",
                 "ro.build.version.release": "11", "ro.build.version.sdk": str(self.profile.get("sdk", 30)),
                 "ro.serialno": self.profile.get("identity", "SERIAL-A")}
        if command.startswith("getprop "):
            return props[command[8:]]
        if command == "dumpsys device_policy":
            owner = self.profile.get("owner")
            return "Device Owner:\n  admin=ComponentInfo{" + owner + "}\nOther:\n" if owner else "No owners\n"
        if command.startswith("dumpsys package"):
            return "versionName=1.2.0\n"
        if command.startswith("pm install"):
            return self.profile.get("install", "Success\n")
        if command.startswith("dpm set-device-owner"):
            return self.profile.get("set_owner", "Success: Device owner set\n")
        if command.startswith("am broadcast"):
            return self.profile.get("broadcast", 'Broadcast completed: result=0, data="home_panel_configured_pin_needed"')
        if command.startswith("am start"):
            return "Starting: Intent { cmp=local.home.hmi/.MainActivity }"
        if command.startswith("rm -f"):
            return ""
        raise AssertionError("Unexpected command: " + command)

    def push(self, source, target, **kwargs):
        self.uploads.append((source, target))

    def close(self):
        self.closed = True


class ProvisionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.profile, self.clients = {}, []
        self.store = types.SimpleNamespace(async_load=AsyncMock(return_value=None), async_save=AsyncMock())
        def connect(*args):
            client = FakeAndroid(self.profile)
            self.clients.append(client)
            return client
        async def executor(func, *args):
            return func(*args)
        self.manager = provision.PanelManager(executor, self.store, Path("unused-key"), connect)
        self.apk = patch.object(provision, "bundled_apk", return_value=(Path("test.apk"), {"min_sdk": 26, "version": "1.3.0"}))
        self.apk.start()
        self.addCleanup(self.apk.stop)

    async def probe(self):
        return await self.manager.async_probe("192.0.2.10", 5555, "admin")

    async def install(self, token, user="admin", full=True, url="https://ha.example/panels/room"):
        return await self.manager.async_install("192.0.2.10", 5555, url, "Test room", full, token, user)

    async def test_probe_reads_only_and_does_not_expose_identity(self):
        result = await self.probe()
        self.assertNotIn("identity", result["device"])
        self.assertTrue(self.clients[0].closed)
        self.assertFalse(self.clients[0].uploads)
        self.assertTrue(all(cmd.startswith(("getprop ", "dumpsys ")) for cmd in self.clients[0].commands))
        self.store.async_save.assert_not_called()

    async def test_unknown_serial_cannot_authorize_installation(self):
        for serial in ("unknown", "0000000000", ""):
            self.profile["identity"] = serial
            with self.assertRaises(provision.ProvisionError) as caught:
                await self.probe()
            self.assertEqual(caught.exception.code, "no_identity")
        self.assertFalse(self.manager.tickets)

    async def test_install_requires_probe(self):
        with self.assertRaisesRegex(provision.ProvisionError, "Сначала проверьте"):
            await self.install("unknown")
        self.assertFalse(self.clients)

    async def test_install_scopes_ticket_to_user(self):
        token = (await self.probe())["probe_token"]
        with self.assertRaises(provision.ProvisionError):
            await self.install(token, user="another-admin")
        self.assertEqual(len(self.clients), 1)

    async def test_ticket_expiry(self):
        token = (await self.probe())["probe_token"]
        self.manager.tickets[token]["expires"] = 0
        with self.assertRaises(provision.ProvisionError):
            await self.install(token)
        self.assertEqual(len(self.clients), 1)

    async def test_full_flow_and_saved_record_have_no_secrets(self):
        token = (await self.probe())["probe_token"]
        result = await self.install(token)
        self.assertTrue(result["ok"])
        self.assertTrue(result["pin_needed"])
        commands = self.clients[-1].commands
        self.assertIn("pm install -t -r " + provision.REMOTE_APK, commands)
        self.assertIn("dpm set-device-owner local.home.hmi/.PanelAdmin", commands)
        self.assertEqual(commands[-1], "rm -f " + provision.REMOTE_APK)
        record = self.store.async_save.call_args.args[0]["panels"][0]
        self.assertEqual(set(record), {"host", "port", "url", "name", "version", "installed_at"})
        self.assertTrue(all(client.closed for client in self.clients))

    async def test_ticket_cannot_be_replayed(self):
        token = (await self.probe())["probe_token"]
        await self.install(token)
        with self.assertRaises(provision.ProvisionError):
            await self.install(token)
        self.assertEqual(len(self.clients), 2)

    async def test_different_device_stops_before_writes(self):
        token = (await self.probe())["probe_token"]
        self.profile["identity"] = "SERIAL-B"
        with self.assertRaises(provision.ProvisionError) as caught:
            await self.install(token)
        self.assertEqual(caught.exception.code, "device_changed")
        self.assertFalse(self.clients[-1].uploads)
        self.assertFalse(any(cmd.startswith(("pm ", "dpm ", "rm ")) for cmd in self.clients[-1].commands))

    async def test_foreign_owner_is_not_removed(self):
        self.profile["owner"] = "other.app/.Admin"
        token = (await self.probe())["probe_token"]
        with self.assertRaises(provision.ProvisionError) as caught:
            await self.install(token)
        self.assertEqual(caught.exception.code, "another_owner")
        self.assertFalse(self.clients[-1].uploads)

    async def test_existing_own_owner_not_reassigned(self):
        self.profile["owner"] = "local.home.hmi/local.home.hmi.PanelAdmin"
        await self.install((await self.probe())["probe_token"])
        self.assertFalse(any(cmd.startswith("dpm ") for cmd in self.clients[-1].commands))

    async def test_owner_setup_can_be_skipped(self):
        await self.install((await self.probe())["probe_token"], full=False)
        commands = self.clients[-1].commands
        self.assertFalse(any(cmd.startswith("dpm ") for cmd in commands))
        self.assertTrue(any(cmd.endswith("--ez enable_lock false") for cmd in commands))

    async def test_old_android_not_modified(self):
        self.profile["sdk"] = 25
        token = (await self.probe())["probe_token"]
        with self.assertRaises(provision.ProvisionError) as caught:
            await self.install(token)
        self.assertEqual(caught.exception.code, "android_too_old")
        self.assertFalse(self.clients[-1].uploads)

    async def test_wrong_signature_keeps_existing_app(self):
        self.profile["install"] = "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"
        with self.assertRaises(provision.ProvisionError) as caught:
            await self.install((await self.probe())["probe_token"])
        self.assertEqual(caught.exception.code, "install_failed")
        commands = self.clients[-1].commands
        self.assertFalse(any("uninstall" in cmd or "pm clear" in cmd or cmd.startswith("dpm ") for cmd in commands))

    async def test_owner_failure_reports_partial_install_without_reset(self):
        self.profile["set_owner"] = "Error: accounts already exist"
        with self.assertRaises(provision.ProvisionError) as caught:
            await self.install((await self.probe())["probe_token"])
        self.assertEqual(caught.exception.code, "owner_failed")
        self.assertEqual(len(caught.exception.steps), 2)
        self.assertFalse(any("reset" in cmd or "account" in cmd or "uninstall" in cmd for cmd in self.clients[-1].commands))

    async def test_save_error_does_not_misreport_install(self):
        self.store.async_save.side_effect = OSError("read-only")
        result = await self.install((await self.probe())["probe_token"])
        self.assertTrue(result["ok"])
        self.assertIn("storage_warning", result)

    async def test_url_shell_characters_stay_one_argument(self):
        url = "https://ha.example/a';touch-file"
        await self.install((await self.probe())["probe_token"], url=url)
        command = next(cmd for cmd in self.clients[-1].commands if cmd.startswith("am broadcast"))
        arguments = shlex.split(command)
        self.assertEqual(arguments[arguments.index("start_url") + 1], url)

    def test_address_and_url_validation(self):
        for host in ("8.8.8.8", "127.0.0.1", "0.0.0.0", "http://192.0.2.10", "192.0.2.10;reboot"):
            with self.assertRaises(provision.ProvisionError):
                provision.validate_address(host)
        for port in (0, 65536, True, "5555"):
            with self.assertRaises(provision.ProvisionError):
                provision.validate_address("192.0.2.10", port)
        for url in ("file:///tmp/x", "http://name:password@ha.example/", "https://ha.example/?access_token=secret", "https://ha.example/a b"):
            with self.assertRaises(provision.ProvisionError):
                provision.validate_url(url)

    async def test_non_admin_cannot_reach_manager(self):
        connection = types.SimpleNamespace(user=types.SimpleNamespace(is_admin=False), send_error=Mock(), send_result=Mock())
        hass = types.SimpleNamespace(data={"hmi_panel": {"enabled": True}})
        await async_manage_panel(hass, connection, {"id": 1, "action": "install"})
        connection.send_error.assert_called_once()
        self.assertNotIn("manager", hass.data["hmi_panel"])

    async def test_disabled_integration_and_pin_input_rejected(self):
        connection = types.SimpleNamespace(user=types.SimpleNamespace(is_admin=True, id="admin"), send_error=Mock(), send_result=Mock())
        hass = types.SimpleNamespace(data={"hmi_panel": {"enabled": False}})
        await async_manage_panel(hass, connection, {"id": 1, "action": "probe"})
        self.assertEqual(connection.send_error.call_args.args[1], "not_loaded")
        hass.data["hmi_panel"]["enabled"] = True
        await async_manage_panel(hass, connection, {"id": 2, "action": "install", "pin": "0000"})
        self.assertEqual(connection.send_error.call_args.args[1], "invalid_format")

    def test_bundled_apk_integrity_and_protected_receiver(self):
        self.apk.stop()
        apk, metadata = provision.bundled_apk()
        self.assertGreater(apk.stat().st_size, 10000)
        manifest = ET.parse(test_integration.ROOT / "android/AndroidManifest.xml").getroot()
        namespace = "{http://schemas.android.com/apk/res/android}"
        self.assertEqual(metadata["version"], manifest.attrib[namespace + "versionName"])
        receiver = next(item for item in manifest.findall("application/receiver") if item.attrib[namespace + "name"] == ".ProvisionReceiver")
        self.assertEqual(receiver.attrib[namespace + "permission"], "android.permission.DUMP")
