#!/usr/bin/env bash
# Shows or hides the calibration section in the extension's settings window
# (SPEC §9 "Desenvolvimento", lib/calibration.js). Usage: calibration.sh on|off
set -euo pipefail

case "${1:-}" in
    on) value=true ;;
    off) value=false ;;
    *) printf 'usage: %s on|off\n' "$0" >&2; exit 2 ;;
esac
uuid="tahoe-dock@unimestre.local"
config="${XDG_CONFIG_HOME:-$HOME/.config}/cinnamon/spices/$uuid/$uuid.json"
[[ -f "$config" ]] || { printf 'no settings at %s: enable the extension first\n' "$config" >&2; exit 1; }
python3 - "$config" "$value" <<'PY'
import json, sys
path, value = sys.argv[1], sys.argv[2] == "true"
with open(path) as f:
    settings = json.load(f)
if "calibration" not in settings:
    sys.exit("no calibration key yet: reload the extension first")
settings["calibration"]["value"] = value
with open(path, "w") as f:
    json.dump(settings, f, indent=4, ensure_ascii=False)
PY
# Cinnamon reads the file again only when told, as its settings window does.
gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
    --method org.Cinnamon.updateSetting "$uuid" "$uuid" calibration "$value" >/dev/null
printf 'calibration %s\n' "$1"
