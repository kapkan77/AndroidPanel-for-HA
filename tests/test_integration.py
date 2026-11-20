"""Fast lifecycle tests using small HA API doubles, without a running house."""
import asyncio
from dataclasses import dataclass
import importlib
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock

import probatio

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def module(name, **attributes):
    result = types.ModuleType(name)
    result.__dict__.update(attributes)
    sys.modules[name] = result
    return result


@dataclass
class StaticPathConfig:
    url_path: str
    path: str
    cache_headers: bool


class Abort(Exception):
    pass


class FakeFlow:
    existing = False

    def __init_subclass__(cls, **kwargs):
        pass

    async def async_set_unique_id(self, value):
        self.unique_id = value

    def _abort_if_unique_id_configured(self):
        if self.existing:
            raise Abort()

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}


module("homeassistant")
module("homeassistant.components")


def websocket_command(schema):
    """Retain declarations for validation with the real HA decorator in CI."""
    def decorate(func):
        func._ws_declared_schema = schema
        return func
    return decorate


websocket_api = module("homeassistant.components.websocket_api",
                       websocket_command=websocket_command,
                       async_response=lambda func: func, async_register_command=Mock())
frontend = module("homeassistant.components.frontend", add_extra_js_url=Mock(), remove_extra_js_url=Mock())
module("homeassistant.components.http", StaticPathConfig=StaticPathConfig)
entries = module("homeassistant.config_entries", ConfigEntry=object, ConfigFlow=FakeFlow)
sys.modules["homeassistant"].config_entries = entries
module("homeassistant.core", HomeAssistant=object)
module("homeassistant.helpers")
module("homeassistant.helpers.typing", ConfigType=dict)
module("homeassistant.helpers.config_validation", config_entry_only_config_schema=lambda domain: {})
module("homeassistant.helpers.storage", Store=Mock())
module("homeassistant.data_entry_flow", FlowResult=dict)
integration = importlib.import_module("custom_components.hmi_panel")
flow_module = importlib.import_module("custom_components.hmi_panel.config_flow")
const = importlib.import_module("custom_components.hmi_panel.const")


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.hass = types.SimpleNamespace(data={}, http=types.SimpleNamespace(async_register_static_paths=AsyncMock()))
        frontend.add_extra_js_url.reset_mock()
        frontend.remove_extra_js_url.reset_mock()

    async def test_register_static_path_once(self):
        self.assertTrue(await integration.async_setup(self.hass, {}))
        self.assertTrue(await integration.async_setup(self.hass, {}))
        self.hass.http.async_register_static_paths.assert_awaited_once()
        route = self.hass.http.async_register_static_paths.call_args.args[0][0]
        self.assertEqual(route.url_path, const.STATIC_URL)
        self.assertTrue((Path(route.path) / "hmi-room-card.js").is_file())

    async def test_failed_static_registration_can_retry(self):
        self.hass.http.async_register_static_paths.side_effect = [RuntimeError("failed"), None]
        with self.assertRaises(RuntimeError):
            await integration.async_setup(self.hass, {})
        self.assertTrue(await integration.async_setup(self.hass, {}))

    async def test_reload_does_not_duplicate_route_or_module(self):
        await integration.async_setup(self.hass, {})
        await integration.async_setup_entry(self.hass, object())
        await integration.async_setup_entry(self.hass, object())
        frontend.add_extra_js_url.assert_called_once_with(self.hass, const.MODULE_URL)
        self.assertTrue(await integration.async_unload_entry(self.hass, object()))
        self.assertTrue(await integration.async_unload_entry(self.hass, object()))
        frontend.remove_extra_js_url.assert_called_once_with(self.hass, const.MODULE_URL)
        await integration.async_setup(self.hass, {})
        await integration.async_setup_entry(self.hass, object())
        self.assertEqual(frontend.add_extra_js_url.call_count, 2)
        self.hass.http.async_register_static_paths.assert_awaited_once()

    async def test_config_flow_no_credentials(self):
        flow = flow_module.HomePanelConfigFlow()
        result = await flow.async_step_user()
        self.assertEqual(result, {"type": "form", "step_id": "user"})
        self.assertEqual(flow.unique_id, const.DOMAIN)
        result = await flow.async_step_user({})
        self.assertEqual(result["data"], {})
        self.assertEqual(result["title"], const.NAME)

    async def test_config_flow_rejects_duplicate(self):
        flow = flow_module.HomePanelConfigFlow()
        flow.existing = True
        with self.assertRaises(Abort):
            await flow.async_step_user({})

    def test_version_and_translation_consistency(self):
        manifest = json.loads((ROOT / "custom_components/hmi_panel/manifest.json").read_text())
        self.assertEqual(manifest["version"], const.VERSION)
        self.assertEqual(manifest["domain"], const.DOMAIN)
        for lang in ("en", "ru"):
            translation = json.loads((ROOT / f"custom_components/hmi_panel/translations/{lang}.json").read_text(encoding="utf-8"))
            self.assertIn("already_configured", translation["config"]["abort"])

    def test_templates_have_no_bindings(self):
        prohibited = {"entity", "entity_id", "entities", "temperature_entity", "heating",
                      "temperature", "humidity", "co2", "voc", "nightlight", "humidifier",
                      "window", "device_id", "area_id", "floor_id", "label_id", "timezone"}
        def inspect(value):
            if isinstance(value, dict):
                self.assertFalse(prohibited.intersection(value))
                for child in value.values():
                    inspect(child)
            elif isinstance(value, list):
                for child in value:
                    inspect(child)
        for name in ("climate-comfort", "blank"):
            template = json.loads((ROOT / f"templates/{name}.json").read_text(encoding="utf-8"))
            inspect(template)
            self.assertEqual(template["room"], "Комната")
            self.assertTrue(any(w["type"] == "settings" for w in template["widgets"]))
            self.assertEqual(len(template["service_menu"]["widgets"]), 8)

    def test_frontend_build_matches_version(self):
        bundle = (ROOT / "custom_components/hmi_panel/www/hmi-room-card.js").read_text(encoding="utf-8")
        self.assertTrue("static get version(){return '" + const.VERSION + "';}" in bundle, "Frontend bundle version is stale")
        self.assertNotIn("/* @grid-", bundle)


if __name__ == "__main__":
    unittest.main()
