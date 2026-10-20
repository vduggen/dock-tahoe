#!/usr/bin/env bash
# Cuts a release: sets the version in metadata.json, turns CHANGELOG.md's
# "Não publicado" section into that version, runs the checks, commits and
# creates the annotated tag v<version>. Does not push.
# Usage: release.sh <MAJOR.MINOR.PATCH>
set -euo pipefail

version="${1:-}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    { printf 'usage: %s <MAJOR.MINOR.PATCH>\n' "$0" >&2; exit 2; }

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_dir"

[[ "$(git branch --show-current)" == main ]] || { printf 'release only from main\n' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { printf 'commit or stash your changes first\n' >&2; exit 1; }
! git rev-parse -q --verify "refs/tags/v$version" >/dev/null ||
    { printf 'tag v%s already exists\n' "$version" >&2; exit 1; }
latest="$(git tag --list 'v*' --sort=-v:refname | head -n 1)"
if [[ -n "$latest" && "$(printf '%s\n%s\n' "${latest#v}" "$version" | sort -V | tail -n 1)" != "$version" ]]; then
    printf 'v%s is not newer than %s\n' "$version" "$latest" >&2
    exit 1
fi

python3 - "$version" "$(date +%Y-%m-%d)" <<'PY'
import json, re, sys
version, date = sys.argv[1], sys.argv[2]

with open("CHANGELOG.md", encoding="utf-8") as f:
    changelog = f.read()
match = re.search(r"^## \[Não publicado\]\n(.*?)(?=^## |\Z)", changelog, re.M | re.S)
if not match or not match.group(1).strip():
    sys.exit("CHANGELOG.md: nothing under [Não publicado]")
changelog = changelog.replace("## [Não publicado]\n",
    "## [Não publicado]\n\n## [%s] - %s\n" % (version, date), 1)
with open("CHANGELOG.md", "w", encoding="utf-8") as f:
    f.write(changelog)

with open("metadata.json", encoding="utf-8") as f:
    metadata = f.read()
metadata, count = re.subn(r'("version":\s*")[^"]*"', r'\g<1>%s"' % version, metadata, count=1)
if count != 1 or json.loads(metadata)["version"] != version:
    sys.exit("metadata.json: no version field")
with open("metadata.json", "w", encoding="utf-8") as f:
    f.write(metadata)
PY

./scripts/check.sh
git add CHANGELOG.md metadata.json
git commit -m "chore: release v$version"
git tag -a "v$version" -m "Tahoe Dock v$version"
printf 'v%s is ready. Publish it with: git push origin main "v%s"\n' "$version" "$version"
