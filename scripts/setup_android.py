"""Use the same audited provisioning sequence without the HA editor.

Install dependency: python -m pip install adb-shell==0.4.4
Default mode checks the target. --install explicitly enables the write steps.
PIN and Home Assistant login remain on the Android panel.
"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_provision", ROOT / "custom_components/hmi_panel/provision.py")
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ip", required=True, help="Local IP of the Android panel")
    parser.add_argument("--port", type=int, default=5555)
    parser.add_argument("--url", help="Full HA dashboard URL; required for --install")
    parser.add_argument("--install", action="store_true", help="Install and configure the bundled APK")
    parser.add_argument("--without-device-owner", action="store_true", help="Skip Device Owner setup")
    parser.add_argument("--key", type=Path, default=Path.home() / ".home-panel" / "adbkey")
    args = parser.parse_args()
    host, port = provision.validate_address(args.ip, args.port)
    if args.install and not args.url:
        parser.error("--install requires --url")
    url = provision.validate_url(args.url) if args.install else None
    client = provision.connect_device(host, port, args.key)
    try:
        info = provision.device_info(client)
        identity = info.pop("identity")
        print(json.dumps({"device": info}, ensure_ascii=False, indent=2), flush=True)
        if args.install:
            if not identity:
                raise provision.ProvisionError("no_identity", "Device did not report a serial number; no installation was attempted.")
            result = provision.install_on_device(client, url, not args.without_device_owner, identity)
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
            print("Create the PIN and log in to HA on the panel; verify startup by rebooting it.")
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except provision.ProvisionError as error:
        print(json.dumps({"ok": False, "code": error.code, "message": str(error), "steps": error.steps}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
