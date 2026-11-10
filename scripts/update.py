#!/usr/bin/env python3
"""User-initiated, fast-forward-only updater for source installations."""
import json
import pathlib
import subprocess
import sys
import threading

REMOTE = "https://github.com/vduggen/dock-tahoe.git"


def run(source, *args):
    return subprocess.run(args, cwd=source, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.strip()


def update(source, desktop, remote=REMOTE):
    source = pathlib.Path(source).resolve()
    if run(source, "git", "rev-parse", "--show-toplevel") != str(source):
        raise RuntimeError("A instalação não aponta para a raiz de um repositório Git.")
    if run(source, "git", "status", "--porcelain"):
        raise RuntimeError("Há alterações locais. Salve-as em um commit antes de atualizar. Nenhum arquivo foi sobrescrito.")
    if run(source, "git", "branch", "--show-current") != "main":
        raise RuntimeError("A atualização automática exige a branch main.")
    run(source, "git", "fetch", "--no-tags", remote, "main")
    run(source, "git", "merge", "--ff-only", "FETCH_HEAD")
    if desktop == "gnome":
        run(source, "node", "scripts/build-gnome.js")
    return "Atualização concluída. Encerre a sessão e entre novamente para carregar o código atualizado."


def main():
    # The GNOME package records its source directory at build time.
    root = pathlib.Path(__file__).resolve().parent.parent
    location = root / "update-source.json"
    source = pathlib.Path(json.loads(location.read_text())["source"]) if location.exists() else root
    desktop = sys.argv[1] if len(sys.argv) > 1 else "cinnamon"
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk

    window = Gtk.Window(title="Atualizar Tahoe Dock")
    window.set_default_size(520, 220)
    window.set_border_width(20)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
    window.add(box)
    label = Gtk.Label(label="Baixar e aplicar a versão mais recente da branch main do GitHub?\n\n"
                      "A atualização preserva suas configurações e recusa alterações locais.\n"
                      "Após atualizar, será necessário entrar novamente na sessão.")
    label.set_line_wrap(True)
    label.set_max_width_chars(65)
    box.pack_start(label, True, True, 0)
    button = Gtk.Button(label="Atualizar agora")
    box.pack_start(button, False, False, 0)

    def finish(message):
        window.set_deletable(True)
        label.set_text(message)
        button.set_label("Fechar")
        button.set_sensitive(True)
        button.disconnect(handler)
        button.connect("clicked", lambda *_: window.destroy())
        return False

    def worker():
        try:
            message = update(source, desktop)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            detail = error.stdout if isinstance(error, subprocess.CalledProcessError) else str(error)
            message = "Não foi possível concluir a atualização:\n\n" + (detail or str(error))
        GLib.idle_add(finish, message)

    def start(*_):
        window.set_deletable(False)
        button.set_sensitive(False)
        label.set_text("Atualizando… Aguarde. Não encerre a sessão.")
        threading.Thread(target=worker, daemon=True).start()

    handler = button.connect("clicked", start)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
