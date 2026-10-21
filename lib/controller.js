// DockController: wires the trackers to one DockView per monitor and
// carries out the views' actions. Shared by Cinnamon (extension.js) and
// GNOME Shell (gnome/extension.js); platform differences go through
// lib/platform.js.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;

const { AppTracker } = require("./lib/appTracker.js");
const { DockView } = require("./lib/dockView.js");
const { LauncherEntry } = require("./lib/launcherEntry.js");
const { Folders } = require("./lib/folders.js");
const { Trash } = require("./lib/trash.js");
const Bookmarks = require("./lib/bookmarks.js");
const Grouping = require("./lib/grouping.js");
const Layout = require("./lib/layout.js");
const Platform = require("./lib/platform.js");
const Stacks = require("./lib/stacks.js");

// How long a launch waits for its window to move it to the dock's monitor.
const PLACEMENT_TIMEOUT_MS = 10000;
// Recent apps shown at most (SPEC §1).
const MAX_RECENT = 3;

class DockController {
    // createSettings(callbacks): a DockSettings (lib/settings.js) that calls
    // `callbacks` on external changes.
    constructor(createSettings) {
        this.views = [];
        this._signals = [];
        this._snapshot = { items: [] };
        // Unpinned apps running at the last snapshot; null before the first.
        this._running = null;
        // When each window last minimized, to order their thumbnails.
        this._minimizedAt = new Map();
        this._rebuildId = 0;
        // { app, monitor, until }: where the next window of a launch goes.
        this._placement = null;
        // A preview being hovered: the window focused before it, and the
        // window it unminimized, if any.
        this._peek = null;
        this.settings = createSettings({
            pinnedApps: () => this.tracker.reloadPinned(),
            position: () => this._rebuildViews(),
            focusHotkey: () => this._bindHotkey(),
            autohide: () => this._rebuildViews(),
            appearance: () => this._rebuildViews(),
            workspaces: () => this._updateViews(),
            recent: () => this._updateViews(),
            folders: () => this._syncFolders()
        });
        this.tracker = new AppTracker(() => this.settings.pinnedApps, snapshot => {
            this._snapshot = snapshot;
            this._noteRecent(snapshot.items);
            this._updateViews();
        }, window => this._aimMinimize(window));
        this.badges = new LauncherEntry(() => this._updateViews());
        this.trash = new Trash(() => this._updateViews());
        this.folders = new Folders(() => this._updateViews());
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
    }

    enable() {
        this._connect(Main.layoutManager, "monitors-changed", () => this._rebuildViews());
        this._connect(this._themeContext, "notify::scale-factor", () => this._rebuildViews());
        // "map" comes after the window manager's placement, so the move sticks.
        this._connect(global.window_manager, "map", (wm, actor) => this._placeNewWindow(actor.meta_window));
        Platform.watchPanels((object, signal, callback) => this._connect(object, signal, callback),
            () => this._queueRebuild());
        this._rebuildViews();
        this.tracker.enable();
        this.badges.enable();
        this.trash.enable();
        this._syncFolders();
        this._bindHotkey();
    }

    disable() {
        this.endPeek(null);
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        Platform.unbindHotkey();
        this.tracker.disable();
        this.badges.disable();
        this.trash.disable();
        this.folders.destroy();
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
        Platform.unbindHotkey();
        Platform.bindHotkey(this.settings, () => {
            const index = global.display.get_current_monitor();
            const view = this.views.find(candidate => candidate.monitor.index === index) || this.views[0];
            if (view)
                view.beginKeyboard();
        });
    }

    // Keyboard focus leaving `view` past one end: on to the next dock in
    // screen order (left to right, then top to bottom), wrapping around;
    // entered from its first icon going forward, its last going back.
    keyboardStep(view, step) {
        const views = this.views.filter(candidate => candidate === view || candidate._order.length)
            .sort((a, b) => a.monitor.x - b.monitor.x || a.monitor.y - b.monitor.y);
        const target = views[(views.indexOf(view) + step + views.length) % views.length];
        view.endKeyboard();
        target.beginKeyboard(step < 0);
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
            new DockView(monitor, position, scale, Platform.panelInset(monitor.index, position),
                this.settings.autohide, this.settings.glassBlur ? this.settings.glassQuality : null,
                { appearance: this.settings.iconAppearance, tint: this.settings.iconTint },
                this.settings.tuning(), this));
        this._updateViews();
    }

    // SPEC §7: launch when there is no window; otherwise bring forward the
    // most recently used window on this monitor. Departs from §7 on request:
    // clicking the focused app minimizes its windows, as a toggle, and an app
    // whose windows are all on other monitors opens a new one here (_launch).
    // Window-backed apps can't open windows, so they still switch.
    activate(entry, monitorIndex) {
        const local = entry.localWindows;
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
        if (entry.permanent)
            return;
        const pinned = this.settings.pinnedApps.slice();
        const index = pinned.indexOf(entry.desktopFileId);
        if (index >= 0)
            pinned.splice(index, 1);
        else
            pinned.push(entry.desktopFileId);
        this.settings.setPinnedApps(pinned);
        this.tracker.reloadPinned();
    }

    // The minimize and unminimize animations head for the window's
    // icon geometry, which the panel's window list also sets, on whatever
    // monitor the panel is. Set right before the animation, it is the icon
    // in the dock of the window's own monitor.
    _aimMinimize(window) {
        if (window.minimized)
            this._minimizedAt.set(window, GLib.get_monotonic_time());
        else
            this._minimizedAt.delete(window);
        const view = this.views.find(candidate => candidate.monitor.index === window.get_monitor());
        const rect = view && view.iconRect(window, !this.settings.minimizeIntoIcon);
        if (rect)
            window.set_icon_geometry(Platform.rectangle(rect));
    }

    // shown: the pinned desktop ids in their new dock order, a newly
    // pinned app among them.
    reorderPinned(shown) {
        const saved = this.settings.pinnedApps;
        const added = shown.filter(id => saved.indexOf(id) < 0);
        this.settings.setPinnedApps(Grouping.reorderPinned(saved.concat(added), shown));
        this.tracker.reloadPinned();
    }

    // This monitor's windows, the ones its menu lists.
    closeWindows(entry) {
        const time = global.get_current_time();
        entry.localWindows.forEach(window => {
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
            info.launch_uris([uri], Platform.launchContext());
        } catch (e) {
            Platform.logError(e, "Tahoe Dock: falha ao abrir " + uri);
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
                entry.info.launch([], Platform.launchContext());
        } catch (e) {
            Platform.logError(e, "Tahoe Dock: falha ao abrir " + entry.name);
        }
    }

    // The window manager places new windows by focus, not by where the dock was clicked.
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
        if (Platform.windowTracker().get_window_app(window) !== placement.app)
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

    // Unpinned apps that stopped running since the last snapshot become
    // recent; the first snapshot only sets what was already running.
    _noteRecent(items) {
        const running = items.filter(item => !item.pinned && item.running && item.desktopFileId)
            .map(item => item.desktopFileId);
        if (this._running) {
            const saved = this.settings.recentApps;
            const recent = Grouping.recentApps(saved, this._running, running, this.settings.pinnedApps, MAX_RECENT);
            if (recent.join() !== saved.join())
                this.settings.setRecentApps(recent);
        }
        this._running = running;
    }

    removeRecent(entry) {
        const id = Grouping.normalizeId(entry.desktopFileId);
        this.settings.setRecentApps(this.settings.recentApps.filter(saved => Grouping.normalizeId(saved) !== id));
        this._updateViews();
    }

    // Downloads, when shown, then the folders the user added, once each.
    _syncFolders() {
        const downloads = Folders.downloadsUri();
        const uris = (this.settings.showDownloads && downloads ? [downloads] : [])
            .concat((this.settings.folders || []).map(row => row && row.uri).filter(Boolean));
        this.folders.set(uris.filter((uri, index) => uris.indexOf(uri) === index));
        this._updateViews();
    }

    // Folders as dock entries, with their items in the order they show.
    _folderEntries() {
        const downloads = Folders.downloadsUri();
        return this.folders.list.map(folder => {
            const options = Stacks.options((this.settings.stackOptions || {})[folder.uri], folder.uri === downloads);
            return {
                key: "folder:" + folder.uri,
                folder: true,
                uri: folder.uri,
                view: options.view,
                sort: options.sort,
                items: Stacks.sortItems(folder.items, options.sort),
                pinned: false,
                name: folder.name,
                gicon: folder.gicon,
                windows: [],
                localWindows: [],
                facts: { pinned: false, running: false, hasWindows: false, focused: false, minimized: false, attention: false },
                badge: null
            };
        });
    }

    openUri(uri) {
        this.folders.open(uri);
    }

    // key: "view" or "sort", from the folder's menu.
    setStackOption(entry, key, value) {
        const options = Object.assign({}, this.settings.stackOptions);
        options[entry.uri] = Object.assign({}, options[entry.uri], { [key]: value });
        this.settings.setStackOptions(options);
        this._updateViews();
    }

    // Downloads is switched off; an added folder leaves the list.
    removeFolder(entry) {
        if (entry.uri === Folders.downloadsUri())
            this.settings.setShowDownloads(false);
        else
            this.settings.setFolders((this.settings.folders || []).filter(row => !row || row.uri !== entry.uri));
        this._syncFolders();
    }

    // With minimize-into-icon off, each minimized window of `entries` as
    // its own entry, oldest first, as the macOS Dock lines them up.
    _minimizedEntries(entries) {
        if (this.settings.minimizeIntoIcon)
            return [];
        const minimized = [];
        entries.forEach(entry => entry.localWindows.forEach(window => {
            if (window.minimized && window.metaWindow)
                minimized.push({ entry: entry, window: window });
        }));
        const at = window => this._minimizedAt.get(window.metaWindow) || 0;
        return minimized.sort((a, b) => at(a.window) - at(b.window)).map(({ entry, window }) => ({
            key: "minimized:" + window.id,
            minimizedWindow: window.metaWindow,
            pinned: false,
            running: true,
            desktopFileId: null,
            app: entry.app,
            info: entry.info,
            gicon: entry.gicon,
            name: window.metaWindow.get_title() || entry.name,
            windows: [window],
            localWindows: [window],
            facts: { pinned: false, running: true, hasWindows: false, focused: false, minimized: true, attention: false },
            badge: null
        }));
    }

    // Recent apps as dock entries: launchers with no windows.
    _recentEntries() {
        if (!this.settings.showRecentApps)
            return [];
        const appSystem = Platform.appSystem();
        return this.settings.recentApps.map(id => appSystem.lookup_app(id)).filter(Boolean).map(app => ({
            key: "recent:" + Grouping.normalizeId(app.get_id()),
            pinned: false,
            recent: true,
            running: false,
            desktopFileId: app.get_id(),
            app: app,
            info: app.get_app_info(),
            name: app.get_name(),
            windows: [],
            localWindows: [],
            facts: { pinned: false, running: false, hasWindows: false, focused: false, minimized: false, attention: false },
            badge: null
        }));
    }

    _fileManagerId() {
        const manager = Gio.AppInfo.get_default_for_type("inode/directory", false);
        return manager ? manager.get_id() : null;
    }

    _updateViews() {
        const primary = Main.layoutManager.primaryIndex;
        const workspace = global.workspace_manager.get_active_workspace_index();
        const fileManager = this._fileManagerId();
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
                        localWindows: Grouping.onMonitor(item, index),
                        // The file manager stays, as Finder does in the macOS Dock.
                        permanent: item.pinned && item.desktopFileId === fileManager,
                        badge: this.badges.label(item.desktopId)
                    }));
            });
            entries.push(...this._recentEntries(), ...this._folderEntries(), ...this._minimizedEntries(entries));
            const trash = this._trashItem();
            const shown = this.settings.currentWorkspaceOnly ? Grouping.onWorkspace(trash, workspace) : trash;
            entries.push(Object.assign(this.trash.entry(shown.windows, Grouping.facts(shown, index)),
                { localWindows: Grouping.onMonitor(shown, index) }));
            // The permanent file manager leads the dock, as Finder does.
            const first = entries.findIndex(entry => entry.permanent);
            if (first > 0)
                entries.unshift(entries.splice(first, 1)[0]);
            view.update(entries);
        });
    }
}
