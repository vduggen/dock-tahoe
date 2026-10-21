#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
for file in "$project_dir"/extension.js "$project_dir"/lib/*.js "$project_dir"/tests/*.js "$project_dir"/scripts/*.js; do
    [[ -e "$file" ]] && node --check "$file"
done
for file in "$project_dir"/*.json "$project_dir"/gnome/*.json; do
    python3 -m json.tool "$file" >/dev/null
done
python3 - "$project_dir/metadata.json" <<'PY'
import json, re, sys
version = json.load(open(sys.argv[1], encoding="utf-8")).get("version", "")
if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
    sys.exit("metadata.json: version %r is not MAJOR.MINOR.PATCH" % version)
PY
# cjs is Cinnamon's build of gjs; elsewhere gjs runs the same tests.
js="$(command -v cjs || command -v gjs)"
(cd "$project_dir" && "$js" tests/run.js)

# The GNOME Shell package: every module must parse as ESM, and the pure
# ones must load as such.
build_dir="$(node "$project_dir/scripts/build-gnome.js")"
for file in "$build_dir"/*.js "$build_dir"/lib/*.js; do
    node --input-type=module --check < "$file" || { printf '%s\n' "$file" >&2; exit 1; }
done
gjs -m "$project_dir/tests/gnome.js" "$build_dir"
printf 'JavaScript syntax, metadata, tests and the GNOME build are valid.\n'
