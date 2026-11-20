"""Check our command using HA 2026.11.2's actual decorator and probatio.

Downloads one pinned, hash-verified upstream source file; never contacts a house.
Only the websocket_command definition is evaluated, with a minimal HA namespace.
"""
import ast
import hashlib
from pathlib import Path
import types
import urllib.request

import probatio

SOURCE = "https://raw.githubusercontent.com/home-assistant/core/2026.11.2/homeassistant/components/websocket_api/decorators.py"
SHA256 = "e69652a7301b374d65bbd7892707ecfb503bb6ecd89eca359d09088eb039051d"


def check():
    data = urllib.request.urlopen(SOURCE, timeout=30).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError("Upstream HA decorator checksum changed")
    definition = next(n for n in ast.parse(data).body if isinstance(n, ast.FunctionDef) and n.name == "websocket_command")
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), definition], type_ignores=[])
    namespace = {"probatio": probatio, "TYPE_CHECKING": False,
                 "messages": types.SimpleNamespace(BASE_COMMAND_MESSAGE_SCHEMA=probatio.Schema({probatio.Required("id"): int}))}
    exec(compile(ast.fix_missing_locations(module), SOURCE, "exec"), namespace)
    source = Path(__file__).resolve().parents[1] / "custom_components/hmi_panel/websocket.py"
    handler = next(n for n in ast.parse(source.read_text(encoding="utf-8")).body if isinstance(n, ast.AsyncFunctionDef))
    decorator = ast.Expression(handler.decorator_list[0])
    decorate = eval(compile(ast.fix_missing_locations(decorator), str(source), "eval"),
                    {"probatio": probatio, "websocket_api": types.SimpleNamespace(websocket_command=namespace["websocket_command"])})
    schema = decorate(lambda: None)._ws_schema
    if schema is False:
        raise AssertionError("HA selected its empty-command fast path: payloads would be rejected")
    base = {"id": 67, "type": "hmi_panel/manage_panel"}
    good = [{**base, "action": "list"},
            {**base, "action": "probe", "host": "192.0.2.10", "port": 5555},
            {**base, "action": "install", "host": "192.0.2.10", "port": 5555,
             "url": "http://ha.example/panel", "name": "Panel", "full_kiosk": True, "probe_token": "one-use-ticket"}]
    for payload in good:
        assert schema(payload) == payload
    bad = [{**base}, {**base, "action": "shell"}, {**good[1], "port": "5555"},
           {**good[1], "port": 0}, {**good[1], "port": 65536}, {**good[1], "host": 123},
           {**good[2], "pin": "0000"}, {**good[2], "password": "example"},
           {**good[2], "full_kiosk": "true"}, {**good[2], "command": "reboot"}]
    for payload in bad:
        try:
            schema(payload)
        except probatio.Invalid:
            continue
        raise AssertionError("Invalid command accepted: " + repr(payload))
    print(f"{len(good)+len(bad)+1} HA framework schema checks passed (pinned upstream decorator).")


if __name__ == "__main__":
    check()
