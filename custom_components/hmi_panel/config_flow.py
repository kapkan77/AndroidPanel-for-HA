"""Enable the local constructor from Devices & services."""

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN, NAME


class HomePanelConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Only one loader is needed, regardless of the number of panels."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Confirm installation; individual panels are configured as cards."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")
