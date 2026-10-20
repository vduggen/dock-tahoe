#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
for file in "$project_dir"/extension.js "$project_dir"/lib/*.js "$project_dir"/tests/*.js; do
    [[ -e "$file" ]] && node --check "$file"
done
python3 -m json.tool "$project_dir/metadata.json" >/dev/null
(cd "$project_dir" && cjs tests/run.js)
printf 'JavaScript syntax, metadata and tests are valid.\n'
