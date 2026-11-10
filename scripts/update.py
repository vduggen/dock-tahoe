#!/usr/bin/env python3
"""User-initiated, fast-forward-only updater for source installations."""
import json
import pathlib
import subprocess
import sys
import threading

REMOTE = "https://github.com/vduggen/dock-tahoe.git"


def reload_cinnamon(source):
    run(source, "gdbus", "call", "--session", "--dest", "org.Cinnamon",
        "--object-path", "/org/Cinnamon", "--method", "org.Cinnamon.ReloadXlet",
        "dock-tahoe@vduggen", "EXTENSION")
    return "Recarga do Tahoe Dock solicitada. Não é necessário encerrar a sessão."


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
    before = run(source, "git", "rev-parse", "HEAD")
    run(source, "git", "fetch", "--no-tags", remote, "main")
    run(source, "git", "merge", "--ff-only", "FETCH_HEAD")
    changed = before != run(source, "git", "rev-parse", "HEAD")
    if desktop == "gnome":
        run(source, "node", "scripts/build-gnome.js")
    if not changed:
        return "O Tahoe Dock já está atualizado. Não é necessário reiniciar a sessão."
    if desktop == "cinnamon":
        try:
            return "Atualização concluída. " + reload_cinnamon(source)
        except (OSError, subprocess.CalledProcessError) as error:
            return "Código atualizado, mas a recarga falhou. Use ‘Recarregar Tahoe Dock’ nas configurações.\n" + str(error)
    return "Atualização concluída. No GNOME Shell, é necessário entrar novamente na sessão para carregar novos módulos."


def main():
    # The GNOME package records its source directory at build time.
    root = pathlib.Path(__file__).resolve().parent.parent
    location = root / "update-source.json"
    source = pathlib.Path(json.loads(location.read_text())["source"]) if location.exists() else root
    desktop = sys.argv[1] if len(sys.argv) > 1 else "cinnamon"
    reload_only = "--reload" in sys.argv
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk

    window = Gtk.Window(title="Recarregar Tahoe Dock" if reload_only else "Atualizar Tahoe Dock")
    window.set_default_size(520, 220)
    window.set_border_width(20)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
    window.add(box)
    label = Gtk.Label(label="Recarregar somente o Tahoe Dock, sem fechar seus aplicativos?" if reload_only else
                      "Baixar e aplicar a versão mais recente da branch main do GitHub?\n\n"
                      "A atualização preserva suas configurações e recusa alterações locais.\n"
                      + ("O dock será recarregado sem encerrar a sessão." if desktop == "cinnamon" else
                         "No GNOME, será necessário entrar novamente na sessão."))
    label.set_line_wrap(True)
    label.set_max_width_chars(65)
    box.pack_start(label, True, True, 0)
    button = Gtk.Button(label="Recarregar agora" if reload_only else "Atualizar agora")
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
            message = reload_cinnamon(source) if reload_only else update(source, desktop)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            detail = error.stdout if isinstance(error, subprocess.CalledProcessError) else str(error)
            message = "Não foi possível concluir a atualização:\n\n" + (detail or str(error))
        GLib.idle_add(finish, message)

    def start(*_):
        window.set_deletable(False)
        button.set_sensitive(False)
        label.set_text("Recarregando…" if reload_only else "Atualizando… Aguarde.")
        threading.Thread(target=worker, daemon=True).start()

    handler = button.connect("clicked", start)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
