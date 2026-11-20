"""Load the Home Panel card without storing household credentials."""

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, MODULE_URL, STATIC_URL
from .websocket import async_register

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the static path once per Home Assistant process."""
    state = hass.data.setdefault(DOMAIN, {})
    if not state.get("websocket_registered"):
        async_register(hass)
        state["websocket_registered"] = True
    if not state.get("static_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "www"), True)]
        )
        state["static_registered"] = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Expose the card to the frontend for all dashboards."""
    state = hass.data[DOMAIN]
    state["enabled"] = True
    if not state.get("module_registered"):
        add_extra_js_url(hass, MODULE_URL)
        state["module_registered"] = True
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Stop loading the module in newly opened browser sessions."""
    state = hass.data[DOMAIN]
    state["enabled"] = False
    if state.pop("module_registered", False):
        remove_extra_js_url(hass, MODULE_URL)
    # HTTP routes cannot be unregistered; keep the registration across reloads.
    return True
