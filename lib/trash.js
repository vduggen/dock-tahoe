// The trash at the dock's far end (SPEC "Pastas e Lixeira"): watches
// trash:/// so its icon shows empty or full, opens it and empties it after
// a confirmation.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Dialog = imports.ui.dialog;
const ModalDialog = imports.ui.modalDialog;

const TRASH_URI = "trash:///";
const ITEM_COUNT = "trash::item-count";
const DISPLAY_NAME = "standard::display-name";

class Trash {
    // onChange(): called when the trash goes from empty to full or back.
    constructor(onChange) {
        this._onChange = onChange;
        this._file = Gio.File.new_for_uri(TRASH_URI);
        this._monitor = null;
        this._monitorId = 0;
        this._cancellable = null;
        this.full = false;
        this.count = 0;
        // The trash's localized name, which file managers use as the title
        // of a window showing it.
        this.title = "";
        this._dialog = null;
    }

    enable() {
        try {
            this._monitor = this._file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect("changed", () => this._refresh());
        } catch (e) {
            global.logError(e, "Dock Tahoe: lixeira sem monitoramento");
        }
        this._refresh();
    }

    disable() {
        if (this._dialog)
            this._dialog.destroy();
        this._dialog = null;
        if (this._cancellable)
            this._cancellable.cancel();
        this._cancellable = null;
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
        }
        this._monitor = null;
    }

    // The dock entry; a fixed key so it is always the same item. windows:
    // the file manager windows showing the trash, and their facts.
    entry(windows, facts) {
        return {
            key: "trash",
            trash: true,
            full: this.full,
            pinned: true,
            name: this.title || "Lixeira",
            gicon: new Gio.ThemedIcon({ name: this.full ? "user-trash-full" : "user-trash" }),
            windows: windows,
            facts: facts,
            badge: null
        };
    }

    open() {
        try {
            Gio.AppInfo.launch_default_for_uri(TRASH_URI, global.create_app_launch_context());
        } catch (e) {
            global.logError(e, "Dock Tahoe: falha ao abrir a lixeira");
        }
    }

    // Deleting is permanent, so it always asks first; Cancel is the default.
    confirmEmpty() {
        if (this._dialog || !this.full)
            return;
        const dialog = new ModalDialog.ModalDialog();
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: "Esvaziar a Lixeira?",
            description: (this.count === 1 ? "O item na Lixeira será apagado"
                : "Os " + this.count + " itens na Lixeira serão apagados") +
                " permanentemente. Esta ação não pode ser desfeita."
        }));
        dialog.setButtons([
            {
                label: "Cancelar",
                action: () => dialog.close(),
                key: Clutter.KEY_Escape,
                default: true
            },
            {
                label: "Esvaziar",
                action: () => {
                    dialog.close();
                    this._empty();
                },
                destructive_action: true
            }
        ]);
        dialog.connect("closed", () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        this._dialog = dialog;
        dialog.open();
    }

    _empty() {
        try {
            const process = Gio.Subprocess.new(["gio", "trash", "--empty"], Gio.SubprocessFlags.NONE);
            process.wait_check_async(null, (proc, result) => {
                try {
                    proc.wait_check_finish(result);
                } catch (e) {
                    global.logError(e, "Dock Tahoe: falha ao esvaziar a lixeira");
                }
                this._refresh();
            });
        } catch (e) {
            global.logError(e, "Dock Tahoe: falha ao esvaziar a lixeira");
        }
    }

    _refresh() {
        if (this._cancellable)
            this._cancellable.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._file.query_info_async(ITEM_COUNT + "," + DISPLAY_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT,
            cancellable, (file, result) => {
                if (cancellable.is_cancelled())
                    return;
                this._cancellable = null;
                let title;
                try {
                    const info = file.query_info_finish(result);
                    this.count = info.get_attribute_uint32(ITEM_COUNT);
                    title = info.get_display_name();
                } catch (e) {
                    return;
                }
                const full = this.count > 0;
                if (full !== this.full || title !== this.title) {
                    this.full = full;
                    this.title = title;
                    this._onChange();
                }
            });
    }
}
