"""Administrator-only provisioning API; no arbitrary commands are exposed."""
from pathlib import Path
import logging

import probatio

from homeassistant.components import websocket_api
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .provision import PanelManager, ProvisionError

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({
    probatio.Required("type"): "hmi_panel/manage_panel",
    probatio.Required("action"): probatio.In(("list", "probe", "install")),
    probatio.Optional("host"): str,
    probatio.Optional("port"): probatio.All(int, probatio.Range(min=1, max=65535)),
    probatio.Optional("url"): str,
    probatio.Optional("name"): str,
    probatio.Optional("full_kiosk"): bool,
    probatio.Optional("probe_token"): str,
})
@websocket_api.async_response
async def async_manage_panel(hass, connection, msg):
    """Explicitly validate all inputs before constructing a manager or opening ADB."""
    user = connection.user
    if user is None or not user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Настройка Android-панелей доступна только администратору HA.")
        return
    state = hass.data.get(DOMAIN, {})
    if not state.get("enabled"):
        connection.send_error(msg["id"], "not_loaded", "Сначала добавьте интеграцию Home Panel в «Устройства и службы».")
        return
    allowed = {"id", "type", "action", "host", "port", "url", "name", "full_kiosk", "probe_token"}
    if set(msg) - allowed or msg.get("action") not in ("list", "probe", "install"):
        connection.send_error(msg["id"], "invalid_format", "Неизвестные поля или действие запроса.")
        return
    if "manager" not in state:
        state["manager"] = PanelManager(hass.async_add_executor_job,
                                       Store(hass, 1, DOMAIN + ".panels"),
                                       Path(hass.config.path(".storage", DOMAIN + "_adbkey")))
    manager = state["manager"]
    try:
        if msg["action"] == "list":
            result = {"ok": True, "panels": await manager.async_list()}
        elif msg["action"] == "probe":
            result = await manager.async_probe(msg.get("host"), msg.get("port", 5555), user.id)
        else:
            result = await manager.async_install(msg.get("host"), msg.get("port", 5555),
                                                msg.get("url"), msg.get("name", "Панель"),
                                                msg.get("full_kiosk", True), msg.get("probe_token"), user.id)
    except ProvisionError as err:
        result = {"ok": False, "code": err.code, "message": str(err), "steps": err.steps}
    except Exception:
        _LOGGER.exception("Android panel operation did not complete")
        result = {"ok": False, "code": "unexpected_error", "message": "Операция не завершена. Проверьте доступность Android и журнал HA.", "steps": []}
    connection.send_result(msg["id"], result)


def async_register(hass):
    """Register once; the handler also checks that the integration is enabled."""
    websocket_api.async_register_command(hass, async_manage_panel)
