#!/usr/bin/env bash
# Links the extension into the desktop's extensions folder. On GNOME Shell
# it builds the package first (scripts/build-gnome.js); run it again after
# changing the code. Usage: install.sh [--cinnamon|--gnome]
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
uuid="dock-tahoe@vduggen"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"

case "${1:-}" in
    --cinnamon) desktop=cinnamon ;;
    --gnome) desktop=gnome ;;
    "")
        case "${XDG_CURRENT_DESKTOP:-}" in
            *Cinnamon*|*X-Cinnamon*) desktop=cinnamon ;;
            *GNOME*) desktop=gnome ;;
            *) printf 'Ambiente não reconhecido (%s): use --cinnamon ou --gnome\n' "${XDG_CURRENT_DESKTOP:-}" >&2; exit 2 ;;
        esac ;;
    *) printf 'uso: %s [--cinnamon|--gnome]\n' "$0" >&2; exit 2 ;;
esac

if [[ "$desktop" == gnome ]]; then
    source_dir="$project_dir/build/gnome/$uuid"
    extensions_dir="$data_dir/gnome-shell/extensions"
    node "$project_dir/scripts/build-gnome.js" >/dev/null
else
    source_dir="$project_dir"
    extensions_dir="$data_dir/cinnamon/extensions"
fi
target="$extensions_dir/$uuid"

mkdir -p "$extensions_dir"
if [[ -e "$target" && ! -L "$target" ]]; then
    printf 'Recusando sobrescrever o diretório existente: %s\n' "$target" >&2
    exit 1
fi
if [[ -L "$target" ]]; then
    existing="$(readlink -f "$target")"
    if [[ "$existing" != "$source_dir" ]]; then
        printf 'Recusando substituir o link existente: %s\n' "$target" >&2
        exit 1
    fi
    printf 'A extensão já aponta para este projeto: %s\n' "$target"
else
    ln -s "$source_dir" "$target"
    printf 'Extensão instalada em %s\n' "$target"
fi

if [[ "$desktop" == gnome ]]; then
    printf 'Encerre a sessão e entre de novo (Wayland), depois ative-a com:\n  gnome-extensions enable %s\n' "$uuid"
    printf 'Desative o Ubuntu Dock para não ter dois docks:\n  gnome-extensions disable ubuntu-dock@ubuntu.com\n'
else
    printf 'Ative-a em Configurações do Sistema → Extensões.\n'
fi
