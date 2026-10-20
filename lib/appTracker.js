// ApplicationTracker + WindowTracker (SPEC §8): turns Cinnamon and Muffin
// signals into dock items. Grouping rules live in lib/grouping.js; this file
// only reads GI objects into plain descriptors. No polling: every refresh is
// triggered by a signal and coalesced into one idle callback.

const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;

const Grouping = require("./lib/grouping.js");

const WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY
];

const DISPLAY_SIGNALS = [
    "notify::focus-window",
    "window-demands-attention",
    "window-marked-urgent",
    "window-monitor-changed",
    "window-workspace-changed",
    "window-skip-taskbar-changed"
];

const WINDOW_SIGNALS = [
    "notify::minimized",
    "notify::wm-class",
    // A file manager window showing the trash lights the trash's dot.
    "notify::title",
    "notify::demands-attention",
    "notify::urgent"
];

class AppTracker {
    // onChanged(snapshot) receives { items }: lib/grouping.js items plus
    // app, info, name, desktopFileId and each window's metaWindow.
    // onMinimizing(metaWindow) runs as soon as a window (un)minimizes, before
    // Muffin starts the animation; onChanged only comes on idle.
    constructor(getPinned, onChanged, onMinimizing) {
        this._getPinned = getPinned;
        this._onChanged = onChanged;
        this._onMinimizing = onMinimizing;
        this._windowTracker = Cinnamon.WindowTracker.get_default();
        this._appSystem = Cinnamon.AppSystem.get_default();
        this._signals = [];
        this._windowSignals = new Map();
        this._pinned = [];
        // Installed StartupWMClass keys (lib/grouping.js launchers), and
        // their real desktop ids by normalized id.
        this._launchers = [];
        this._launcherIds = new Map();
        this._idleId = 0;
    }

    enable() {
        this._connect(global.display, "window-created", (display, window) => {
            this._trackWindow(window);
            this.queueRefresh();
        });
        DISPLAY_SIGNALS.forEach(signal => this._connect(global.display, signal));
        this._connect(this._windowTracker, "window-app-changed");
        this._connect(global.workspace_manager, "active-workspace-changed");
        this._connect(this._appSystem, "app-state-changed");
        this._connect(this._appSystem, "installed-changed", () => this.reloadPinned());

        global.get_window_actors().forEach(actor => this._trackWindow(actor.meta_window));
        this.reloadPinned();
    }

    disable() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        this._signals.forEach(([object, id]) => object.disconnect(id));
        this._signals = [];
        this._windowSignals.forEach((ids, window) => ids.forEach(id => window.disconnect(id)));
        this._windowSignals.clear();
    }

    reloadPinned() {
        this._launchers = [];
        this._launcherIds.clear();
        Gio.AppInfo.get_all().forEach(info => {
            const wmClass = info instanceof Gio.DesktopAppInfo ? info.get_startup_wm_class() : null;
            if (!wmClass || !info.get_id())
                return;
            this._launchers.push({ desktopId: info.get_id(), wmClass: wmClass });
            this._launcherIds.set(Grouping.normalizeId(info.get_id()), info.get_id());
        });
        this._pinned = [];
        (this._getPinned() || []).forEach(desktopId => {
            const info = Gio.DesktopAppInfo.new(desktopId);
            if (!info) {
                global.log("Dock Tahoe: lançador não encontrado: " + desktopId);
                return;
            }
            const wmClass = info.get_startup_wm_class();
            this._pinned.push({ desktopId: desktopId, wmClasses: wmClass ? [wmClass] : [], info: info });
        });
        this.queueRefresh();
    }

    queueRefresh() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            try {
                this._onChanged(this._snapshot());
            } catch (e) {
                global.logError(e, "Dock Tahoe: falha ao atualizar aplicativos");
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _connect(object, signal, callback) {
        const id = object.connect(signal, callback || (() => this.queueRefresh()));
        this._signals.push([object, id]);
    }

    _trackWindow(window) {
        if (!window || this._windowSignals.has(window))
            return;
        const ids = WINDOW_SIGNALS.map(signal => window.connect(signal, () => this.queueRefresh()));
        ids.push(window.connect("notify::minimized", () => this._onMinimizing(window)));
        ids.push(window.connect("unmanaged", () => {
            ids.forEach(id => window.disconnect(id));
            this._windowSignals.delete(window);
            this.queueRefresh();
        }));
        this._windowSignals.set(window, ids);
    }

    _snapshot() {
        const focusWindow = global.display.get_focus_window();
        const apps = new Map();
        const windows = new Map();
        const descriptors = [];

        this._windowSignals.forEach((ids, window) => {
            if (WINDOW_TYPES.indexOf(window.get_window_type()) < 0)
                return;
            const app = this._windowTracker.get_window_app(window);
            const appId = app ? Grouping.normalizeId(app.get_id()) : "";
            if (app)
                apps.set(appId, app);
            const id = window.get_stable_sequence();
            windows.set(id, window);
            const workspace = window.get_workspace();
            descriptors.push({
                id: id,
                sequence: id,
                app: app,
                appId: appId,
                wmClasses: [window.get_wm_class(), window.get_wm_class_instance()],
                monitor: window.get_monitor(),
                workspace: workspace ? workspace.index() : -1,
                allWorkspaces: window.is_on_all_workspaces(),
                minimized: window.minimized,
                focused: window === focusWindow,
                attention: window.demands_attention || window.urgent,
                skipTaskbar: window.is_skip_taskbar()
            });
        });

        const running = this._appSystem.get_running().map(app => {
            const appId = Grouping.normalizeId(app.get_id());
            apps.set(appId, app);
            return appId;
        });
        // Attach the GI objects the view and actions need. Pinned items come
        // first and in the same order as this._pinned (lib/grouping.js).
        const items = Grouping.group(this._pinned, descriptors, running, this._launchers);
        items.forEach((item, index) => {
            if (item.pinned) {
                const spec = this._pinned[index];
                item.desktopFileId = spec.desktopId;
                item.info = spec.info;
                item.app = this._appSystem.lookup_app(spec.desktopId);
            } else {
                const launcherId = this._launcherIds.get(item.desktopId);
                item.app = apps.get(item.desktopId) ||
                    (launcherId && this._appSystem.lookup_app(launcherId)) ||
                    (item.windows[0] && item.windows[0].app) || null;
                item.desktopFileId = item.app && !item.app.is_window_backed() ? item.app.get_id() : null;
                item.info = null;
            }
            item.name = item.app ? item.app.get_name()
                : item.info ? item.info.get_display_name() : item.key;
            item.windows.forEach(entry => entry.metaWindow = windows.get(entry.id));
        });

        return { items: items };
    }
}
