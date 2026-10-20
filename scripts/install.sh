#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
uuid="dock-tahoe@vduggen"
extensions_dir="${XDG_DATA_HOME:-$HOME/.local/share}/cinnamon/extensions"
target="$extensions_dir/$uuid"

mkdir -p "$extensions_dir"
if [[ -e "$target" && ! -L "$target" ]]; then
    printf 'Recusando sobrescrever o diretório existente: %s\n' "$target" >&2
    exit 1
fi
if [[ -L "$target" ]]; then
    existing="$(readlink -f "$target")"
    if [[ "$existing" == "$project_dir" ]]; then
        printf 'A extensão já aponta para este projeto: %s\n' "$target"
        exit 0
    fi
    printf 'Recusando substituir o link existente: %s\n' "$target" >&2
    exit 1
fi

ln -s "$project_dir" "$target"
printf 'Extensão instalada em %s\nAtive-a em Configurações do Sistema → Extensões.\n' "$target"
