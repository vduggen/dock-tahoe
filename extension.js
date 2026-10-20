// Dock Tahoe — entry points called by Cinnamon's extension system.

const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;
const { PanelLoc } = imports.ui.panel;

const { AppTracker } = require("./lib/appTracker.js");
const { DockSettings } = require("./lib/settings.js");
const { DockView } = require("./lib/dockView.js");
const { LauncherEntry } = require("./lib/launcherEntry.js");
const Grouping = require("./lib/grouping.js");
const Layout = require("./lib/layout.js");

const PANEL_KEYS = ["panels-enabled", "panels-height", "panels-autohide"];
const HOTKEY_NAME = "tahoe-dock-focus";

let _metadata = null;
let _controller = null;

class DockController {
    constructor(metadata) {
        this.views = [];
        this._signals = [];
        this._snapshot = { items: [] };
        this._rebuildId = 0;
        this.settings = new DockSettings(metadata.uuid, {
            pinnedApps: () => this.tracker.reloadPinned(),
            position: () => this._rebuildViews(),
            focusHotkey: () => this._bindHotkey(),
            autohide: () => this._rebuildViews(),
            appearance: () => this._rebuildViews()
        });
        this.tracker = new AppTracker(() => this.settings.pinnedApps, snapshot => {
            this._snapshot = snapshot;
            this._updateViews();
        });
        this.badges = new LauncherEntry(() => this._updateViews());
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
    }

    enable() {
        this._connect(Main.layoutManager, "monitors-changed", () => this._rebuildViews());
        this._connect(this._themeContext, "notify::scale-factor", () => this._rebuildViews());
        PANEL_KEYS.forEach(key =>
            this._connect(global.settings, "changed::" + key, () => this._queueRebuild()));
        this._rebuildViews();
        this.tracker.enable();
        this.badges.enable();
        this._bindHotkey();
    }

    disable() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        Main.keybindingManager.removeHotKey(HOTKEY_NAME);
        this.tracker.disable();
        this.badges.disable();
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
    // most recently used window, preferring this monitor. Departs from §7 on
    // request: clicking the focused app minimizes its windows, as a toggle.
    activate(entry, monitorIndex) {
        const local = entry.windows.filter(window => window.monitor === monitorIndex);
        const candidates = (local.length ? local : entry.windows)
            .map(window => window.metaWindow)
            .filter(Boolean)
            .sort((a, b) => b.get_user_time() - a.get_user_time());
        if (!candidates.length) {
            this._launch(entry);
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

    openNewWindow(entry) {
        if (entry.app && entry.windows.length)
            entry.app.open_new_window(-1);
        else
            this._launch(entry);
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

    _launch(entry) {
        try {
            if (entry.app)
                entry.app.activate();
            else if (entry.info)
                entry.info.launch([], global.create_app_launch_context());
        } catch (e) {
            global.logError(e, "Dock Tahoe: falha ao abrir " + entry.name);
        }
    }

    // Each monitor shows the pinned apps plus the unpinned apps with windows
    // on it; running apps without any window go to the primary monitor.
    _updateViews() {
        const primary = Main.layoutManager.primaryIndex;
        this.views.forEach(view => {
            const index = view.monitor.index;
            const entries = [];
            this._snapshot.items.forEach(item => {
                const facts = Grouping.facts(item, index);
                const visible = item.pinned || facts.hasWindows ||
                    (item.windows.length === 0 && item.running && index === primary);
                if (visible)
                    entries.push(Object.assign({}, item, {
                        facts: facts,
                        badge: this.badges.label(item.desktopId)
                    }));
            });
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
