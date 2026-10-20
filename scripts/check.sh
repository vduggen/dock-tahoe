#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
for file in "$project_dir"/extension.js "$project_dir"/lib/*.js "$project_dir"/tests/*.js; do
    [[ -e "$file" ]] && node --check "$file"
done
for file in "$project_dir"/*.json; do
    python3 -m json.tool "$file" >/dev/null
done
python3 - "$project_dir/metadata.json" <<'PY'
import json, re, sys
version = json.load(open(sys.argv[1], encoding="utf-8")).get("version", "")
if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
    sys.exit("metadata.json: version %r is not MAJOR.MINOR.PATCH" % version)
PY
(cd "$project_dir" && cjs tests/run.js)
printf 'JavaScript syntax, metadata and tests are valid.\n'
