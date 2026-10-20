// Dock Tahoe — entry points called by Cinnamon's extension system.

const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;
const { PanelLoc } = imports.ui.panel;

const { AppTracker } = require("./lib/appTracker.js");
const { DockSettings } = require("./lib/settings.js");
const { DockView } = require("./lib/dockView.js");
const { LauncherEntry } = require("./lib/launcherEntry.js");
const { Trash } = require("./lib/trash.js");
const Bookmarks = require("./lib/bookmarks.js");
const Grouping = require("./lib/grouping.js");
const Layout = require("./lib/layout.js");

const PANEL_KEYS = ["panels-enabled", "panels-height", "panels-autohide"];
const HOTKEY_NAME = "tahoe-dock-focus";
// How long a launch waits for its window to move it to the dock's monitor.
const PLACEMENT_TIMEOUT_MS = 10000;

let _metadata = null;
let _controller = null;

class DockController {
    constructor(metadata) {
        this.views = [];
        this._signals = [];
        this._snapshot = { items: [] };
        this._rebuildId = 0;
        // { app, monitor, until }: where the next window of a launch goes.
        this._placement = null;
        // A preview being hovered: the window focused before it, and the
        // window it unminimized, if any.
        this._peek = null;
        this.settings = new DockSettings(metadata.uuid, {
            pinnedApps: () => this.tracker.reloadPinned(),
            position: () => this._rebuildViews(),
            focusHotkey: () => this._bindHotkey(),
            autohide: () => this._rebuildViews(),
            appearance: () => this._rebuildViews(),
            workspaces: () => this._updateViews()
        });
        this.tracker = new AppTracker(() => this.settings.pinnedApps, snapshot => {
            this._snapshot = snapshot;
            this._updateViews();
        });
        this.badges = new LauncherEntry(() => this._updateViews());
        this.trash = new Trash(() => this._updateViews());
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
    }

    enable() {
        this._connect(Main.layoutManager, "monitors-changed", () => this._rebuildViews());
        this._connect(this._themeContext, "notify::scale-factor", () => this._rebuildViews());
        // "map" comes after Muffin's placement, so the move sticks.
        this._connect(global.window_manager, "map", (wm, actor) => this._placeNewWindow(actor.meta_window));
        PANEL_KEYS.forEach(key =>
            this._connect(global.settings, "changed::" + key, () => this._queueRebuild()));
        this._rebuildViews();
        this.tracker.enable();
        this.badges.enable();
        this.trash.enable();
        this._bindHotkey();
    }

    disable() {
        this.endPeek(null);
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        Main.keybindingManager.removeHotKey(HOTKEY_NAME);
        this.tracker.disable();
        this.badges.disable();
        this.trash.disable();
        this._signals.forEach(([object, id]) => object.disconnect(id));
        this._signals = [];
        this.views.forEach(view => view.destroy());
        this.views = [];
        this.settings.destroy();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _bindHotkey() {
        Main.keybindingManager.removeHotKey(HOTKEY_NAME);
        Main.keybindingManager.addHotKey(HOTKEY_NAME, this.settings.focusHotkey, () => {
            const index = global.display.get_current_monitor();
            const view = this.views.find(candidate => candidate.monitor.index === index) || this.views[0];
            if (view)
                view.beginKeyboard();
        });
    }

    // Panels resize after their settings change; wait for that to settle.
    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuildViews();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildViews() {
        this.views.forEach(view => view.destroy());
        const scale = this._themeContext.scale_factor;
        const position = Layout.POSITIONS.indexOf(this.settings.position) >= 0
            ? this.settings.position
            : "bottom";
        this.views = Main.layoutManager.monitors.map(monitor =>
            new DockView(monitor, position, scale, this._panelInset(monitor.index, position),
                this.settings.autohide, this.settings.tokenOverrides(), this));
        this._updateViews();
    }

    // Thickness of the always-visible Cinnamon panels on the dock's edge, so
    // the dock floats above them instead of covering them.
    _panelInset(monitorIndex, position) {
        if (!Main.panelManager)
            return 0;
        const location = PanelLoc[position];
        return Main.panelManager.getPanelsInMonitor(monitorIndex)
            .filter(panel => panel.panelPosition === location && !panel.isHideable())
            .reduce((sum, panel) => sum + (position === "bottom"
                ? panel.actor.get_height()
                : panel.actor.get_width()), 0);
    }

    // SPEC §7: launch when there is no window; otherwise bring forward the
    // most recently used window on this monitor. Departs from §7 on request:
    // clicking the focused app minimizes its windows, as a toggle, and an app
    // whose windows are all on other monitors opens a new one here (_launch).
    // Window-backed apps can't open windows, so they still switch.
    activate(entry, monitorIndex) {
        const local = entry.windows.filter(window => window.monitor === monitorIndex);
        const candidates = (local.length || entry.desktopFileId ? local : entry.windows)
            .map(window => window.metaWindow)
            .filter(Boolean)
            .sort((a, b) => b.get_user_time() - a.get_user_time());
        if (!candidates.length) {
            this._launch(entry, monitorIndex);
            return;
        }

        const focused = global.display.get_focus_window();
        if (focused && !focused.minimized && candidates.includes(focused)) {
            candidates.forEach(window => window.minimize());
            return;
        }
        this.activateWindow(candidates[0]);
    }

    activateWindow(window) {
        const time = global.get_current_time();
        if (window.minimized)
            window.unminimize();
        const workspace = window.get_workspace();
        Main.activateWindow(window, time, workspace ? workspace.index() : undefined);
    }

    // A hovered preview brings its window forward, only for a look: endPeek()
    // puts things back. Never leaves the current workspace.
    peekWindow(window) {
        const workspace = window.get_workspace();
        if (!window.is_on_all_workspaces() && workspace !== global.workspace_manager.get_active_workspace())
            return;
        if (!this._peek)
            this._peek = { previous: global.display.get_focus_window(), unminimized: null };
        this._unpeekMinimized(window);
        if (window.minimized)
            this._peek.unminimized = window;
        this.activateWindow(window);
    }

    // kept: the window chosen with a click, which stays; otherwise the
    // previously focused window comes back.
    endPeek(kept) {
        const peek = this._peek;
        if (!peek)
            return;
        this._peek = null;
        if (peek.unminimized && peek.unminimized !== kept)
            peek.unminimized.minimize();
        if (kept)
            return;
        if (peek.previous && peek.previous.get_compositor_private() && !peek.previous.minimized)
            this.activateWindow(peek.previous);
        else if (global.display.get_focus_window())
            global.display.get_focus_window().lower();
    }

    _unpeekMinimized(next) {
        const unminimized = this._peek.unminimized;
        if (unminimized && unminimized !== next) {
            unminimized.minimize();
            this._peek.unminimized = null;
        }
    }

    openTrash() {
        this.trash.open();
    }

    emptyTrash() {
        this.trash.confirmEmpty();
    }

    openNewWindow(entry, monitorIndex) {
        if (!entry.app || !entry.windows.length) {
            this._launch(entry, monitorIndex);
            return;
        }
        this._expectWindow(entry, monitorIndex);
        entry.app.open_new_window(-1);
    }

    // Window-backed apps have no desktop file, so the menu never offers them.
    togglePin(entry) {
        const pinned = this.settings.pinnedApps.slice();
        const index = pinned.indexOf(entry.desktopFileId);
        if (index >= 0)
            pinned.splice(index, 1);
        else
            pinned.push(entry.desktopFileId);
        this.settings.setPinnedApps(pinned);
        this.tracker.reloadPinned();
    }

    closeWindows(entry) {
        const time = global.get_current_time();
        entry.windows.forEach(window => {
            if (window.metaWindow)
                window.metaWindow.delete(time);
        });
    }

    // For the default file manager: its home folder and the GTK bookmarks
    // (its sidebar favorites), as [{ uri, name }]; null for other apps.
    folderShortcuts(entry) {
        if (!entry.desktopFileId || this._fileManagerId() !== entry.desktopFileId)
            return null;
        // As in Nemo's sidebar: "Favoritos", then the bookmarks.
        let bookmarks = [{ uri: Gio.File.new_for_path(GLib.get_home_dir()).get_uri(), name: "Pasta pessoal" }];
        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), "gtk-3.0", "bookmarks"]));
            const [, contents] = file.load_contents(null);
            bookmarks = bookmarks.concat(Bookmarks.parse(new TextDecoder().decode(contents)));
        } catch (e) {
            // No bookmarks file yet.
        }
        return [
            { title: "Favoritos", folders: this._xappFavorites() },
            { title: "Marcadores", folders: bookmarks }
        ].filter(section => section.folders.length);
    }

    _xappFavorites() {
        const schema = Gio.SettingsSchemaSource.get_default().lookup("org.x.apps.favorites", true);
        if (!schema)
            return [];
        return Bookmarks.parseFavorites(new Gio.Settings({ settings_schema: schema }).get_strv("list"));
    }

    openFolder(entry, uri, monitorIndex) {
        const info = entry.info || (entry.app && entry.app.get_app_info());
        if (!info)
            return;
        this._expectWindow(entry, monitorIndex);
        try {
            info.launch_uris([uri], global.create_app_launch_context());
        } catch (e) {
            global.logError(e, "Dock Tahoe: falha ao abrir " + uri);
        }
    }

    _launch(entry, monitorIndex) {
        this._expectWindow(entry, monitorIndex);
        try {
            // Windows only on other monitors or workspaces: a new window
            // here, instead of activate() switching away.
            if (entry.app && entry.app.get_windows().length)
                entry.app.open_new_window(-1);
            else if (entry.app)
                entry.app.activate();
            else if (entry.info)
                entry.info.launch([], global.create_app_launch_context());
        } catch (e) {
            global.logError(e, "Dock Tahoe: falha ao abrir " + entry.name);
        }
    }

    // Muffin places new windows by focus, not by where the dock was clicked.
    _expectWindow(entry, monitorIndex) {
        this._placement = entry.app && monitorIndex !== undefined ? {
            app: entry.app,
            monitor: monitorIndex,
            until: GLib.get_monotonic_time() / 1000 + PLACEMENT_TIMEOUT_MS
        } : null;
    }

    _placeNewWindow(window) {
        const placement = this._placement;
        if (!placement || !window)
            return;
        if (GLib.get_monotonic_time() / 1000 > placement.until) {
            this._placement = null;
            return;
        }
        if (Cinnamon.WindowTracker.get_default().get_window_app(window) !== placement.app)
            return;
        this._placement = null;
        if (window.get_monitor() !== placement.monitor)
            window.move_to_monitor(placement.monitor);
    }

    // Each monitor shows the pinned apps plus the unpinned apps with windows
    // on it; running apps without any window go to the primary monitor.
    // With current-workspace-only, windows on other workspaces don't count,
    // for the dots, clicks and menus alike.
    // The trash as a grouping item: the file manager's windows titled after it.
    _trashItem() {
        const manager = this._fileManagerId();
        const windows = [];
        if (manager && this.trash.title)
            this._snapshot.items.filter(item => item.desktopFileId === manager).forEach(item =>
                windows.push(...item.windows.filter(window =>
                    window.metaWindow && window.metaWindow.get_title() === this.trash.title)));
        return { pinned: true, running: windows.length > 0, windows: windows };
    }

    _fileManagerId() {
        const manager = Gio.AppInfo.get_default_for_type("inode/directory", false);
        return manager ? manager.get_id() : null;
    }

    _updateViews() {
        const primary = Main.layoutManager.primaryIndex;
        const workspace = global.workspace_manager.get_active_workspace_index();
        this.views.forEach(view => {
            const index = view.monitor.index;
            const entries = [];
            this._snapshot.items.forEach(all => {
                const item = this.settings.currentWorkspaceOnly ? Grouping.onWorkspace(all, workspace) : all;
                const facts = Grouping.facts(item, index);
                const visible = item.pinned || facts.hasWindows ||
                    (all.windows.length === 0 && item.running && index === primary);
                if (visible)
                    entries.push(Object.assign({}, item, {
                        facts: facts,
                        badge: this.badges.label(item.desktopId)
                    }));
            });
            const trash = this._trashItem();
            const shown = this.settings.currentWorkspaceOnly ? Grouping.onWorkspace(trash, workspace) : trash;
            entries.push(this.trash.entry(shown.windows, Grouping.facts(shown, index)));
            view.update(entries);
        });
    }
}

function init(metadata) {
    _metadata = metadata;
}

function enable() {
    _controller = new DockController(_metadata);
    _controller.enable();
    global.log("Dock Tahoe v" + _metadata.version + " ativo");
}

function disable() {
    if (_controller) {
        _controller.disable();
        _controller = null;
    }
    global.log("Dock Tahoe v" + _metadata.version + " desativado");
}
