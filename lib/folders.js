// Folders kept in the dock as stacks (SPEC "Pastas e Lixeira"): each one
// is watched (Gio.FileMonitor) and listed, so its stack shows what is in it
// now. Opening items and folders goes to their default app.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const Platform = require("./lib/platform.js");

const ATTRIBUTES = ["standard::name", "standard::display-name", "standard::icon", "standard::type",
    "standard::content-type", "standard::is-hidden", "standard::is-backup", "time::modified",
    "time::created", "thumbnail::path"].join(",");
// Listing pages, and how long a burst of changes settles before a relist.
const PAGE = 100;
const SETTLE_MS = 300;

class Folder {
    // onChange(): its name, icon or items changed.
    constructor(uri, onChange) {
        this.uri = uri;
        this.file = Gio.File.new_for_uri(uri);
        this.name = this.file.get_basename() || uri;
        this.gicon = new Gio.ThemedIcon({ name: "folder" });
        // [{ uri, name, gicon, directory, kind, modified, created }], unsorted.
        this.items = [];
        this._onChange = onChange;
        this._cancellable = null;
        this._settleId = 0;
        this._monitor = null;
        try {
            this._monitor = this.file.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.connect("changed", () => this._queueRefresh());
        } catch (e) {
            Platform.logError(e, "Tahoe Dock: pasta sem monitoramento: " + uri);
        }
        this._refresh();
    }

    _queueRefresh() {
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._settleId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (this._cancellable)
            this._cancellable.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this.file.query_info_async("standard::display-name,standard::icon", Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                try {
                    const info = file.query_info_finish(result);
                    this.name = info.get_display_name();
                    this.gicon = info.get_icon() || this.gicon;
                } catch (e) {
                    if (cancellable.is_cancelled())
                        return;
                }
                this._list(cancellable);
            });
    }

    _list(cancellable) {
        const items = [];
        const done = () => {
            if (this._cancellable === cancellable)
                this._cancellable = null;
            this.items = items;
            this._onChange();
        };
        this.file.enumerate_children_async(ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT,
            cancellable, (file, result) => {
                let enumerator;
                try {
                    enumerator = file.enumerate_children_finish(result);
                } catch (e) {
                    if (!cancellable.is_cancelled())
                        done();
                    return;
                }
                const next = () => enumerator.next_files_async(PAGE, GLib.PRIORITY_DEFAULT, cancellable, (en, res) => {
                    let infos;
                    try {
                        infos = en.next_files_finish(res);
                    } catch (e) {
                        return;
                    }
                    if (!infos.length) {
                        enumerator.close_async(GLib.PRIORITY_DEFAULT, null, null);
                        done();
                        return;
                    }
                    infos.forEach(info => {
                        if (!info.get_is_hidden() && !info.get_is_backup())
                            items.push(this._item(info));
                    });
                    next();
                });
                next();
            });
    }

    _item(info) {
        const child = this.file.get_child(info.get_name());
        const thumbnail = info.get_attribute_byte_string("thumbnail::path");
        const directory = info.get_file_type() === Gio.FileType.DIRECTORY;
        return {
            uri: child.get_uri(),
            name: info.get_display_name(),
            gicon: thumbnail ? new Gio.FileIcon({ file: Gio.File.new_for_path(thumbnail) })
                : info.get_icon() || new Gio.ThemedIcon({ name: "text-x-generic" }),
            directory: directory,
            kind: info.get_content_type() || "",
            modified: info.get_attribute_uint64("time::modified"),
            created: info.get_attribute_uint64("time::created")
        };
    }

    destroy() {
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = 0;
        if (this._cancellable)
            this._cancellable.cancel();
        this._cancellable = null;
        if (this._monitor)
            this._monitor.cancel();
        this._monitor = null;
    }
}

class Folders {
    // onChange(): a folder's name, icon or items changed.
    constructor(onChange) {
        this._onChange = onChange;
        // Folder by URI, in dock order.
        this._folders = new Map();
    }

    // The XDG download folder, which the dock shows by default.
    static downloadsUri() {
        const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
        return path ? Gio.File.new_for_path(path).get_uri() : null;
    }

    // uris: the folders to show, in order. Keeps the ones already watched.
    set(uris) {
        const wanted = new Set(uris);
        this._folders.forEach((folder, uri) => {
            if (!wanted.has(uri)) {
                folder.destroy();
                this._folders.delete(uri);
            }
        });
        const folders = new Map();
        uris.forEach(uri => folders.set(uri, this._folders.get(uri) || new Folder(uri, () => this._onChange())));
        this._folders = folders;
    }

    get list() {
        return Array.from(this._folders.values());
    }

    open(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, Platform.launchContext());
        } catch (e) {
            Platform.logError(e, "Tahoe Dock: falha ao abrir " + uri);
        }
    }

    destroy() {
        this._folders.forEach(folder => folder.destroy());
        this._folders.clear();
    }
}
