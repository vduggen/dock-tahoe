// The trash at the dock's far end (SPEC "Pastas e Lixeira"): watches
// trash:/// so its icon shows empty or full, and opens it.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const TRASH_URI = "trash:///";
const ITEM_COUNT = "trash::item-count";

class Trash {
    // onChange(): called when the trash goes from empty to full or back.
    constructor(onChange) {
        this._onChange = onChange;
        this._file = Gio.File.new_for_uri(TRASH_URI);
        this._monitor = null;
        this._monitorId = 0;
        this._cancellable = null;
        this.full = false;
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
        if (this._cancellable)
            this._cancellable.cancel();
        this._cancellable = null;
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
        }
        this._monitor = null;
    }

    // The dock entry; a fixed key so it is always the same item.
    entry() {
        return {
            key: "trash",
            trash: true,
            pinned: true,
            name: "Lixeira",
            gicon: new Gio.ThemedIcon({ name: this.full ? "user-trash-full" : "user-trash" }),
            windows: [],
            facts: { pinned: true, running: false, hasWindows: false, focused: false, minimized: false, attention: false },
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

    _refresh() {
        if (this._cancellable)
            this._cancellable.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._file.query_info_async(ITEM_COUNT, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT,
            cancellable, (file, result) => {
                if (cancellable.is_cancelled())
                    return;
                this._cancellable = null;
                let full;
                try {
                    full = file.query_info_finish(result).get_attribute_uint32(ITEM_COUNT) > 0;
                } catch (e) {
                    return;
                }
                if (full !== this.full) {
                    this.full = full;
                    this._onChange();
                }
            });
    }
}
