"""Build the self-contained Lovelace module, using only the Python stdlib."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "frontend/room-runtime.js").read_text(encoding="utf-8")
for part in ("grid-core", "grid-templates", "grid-provisioner", "grid-editor"):
    marker = "/* @" + part + " */"
    if source.count(marker) != 1:
        raise RuntimeError(f"Expected one {marker}")
    source = source.replace(marker, (ROOT / f"frontend/{part}.js").read_text(encoding="utf-8"))
target = ROOT / "custom_components/hmi_panel/www/hmi-room-card.js"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(source, encoding="utf-8", newline="\n")
print(f"Built {target.name}: {target.stat().st_size} bytes")
