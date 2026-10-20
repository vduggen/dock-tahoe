// Dock Tahoe — entry points called by Cinnamon's extension system.

const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Main = imports.ui.main;
const { PanelLoc } = imports.ui.panel;

const { AppTracker } = require("./lib/appTracker.js");
const { DockSettings } = require("./lib/settings.js");
const { DockView } = require("./lib/dockView.js");
const Grouping = require("./lib/grouping.js");

const PANEL_KEYS = ["panels-enabled", "panels-height", "panels-autohide"];

let _metadata = null;
let _controller = null;

class DockController {
    constructor(metadata) {
        this.views = [];
        this._signals = [];
        this._snapshot = { items: [] };
        this._rebuildId = 0;
        this.settings = new DockSettings(metadata.uuid, () => this.tracker.reloadPinned());
        this.tracker = new AppTracker(() => this.settings.pinnedApps, snapshot => {
            this._snapshot = snapshot;
            this._updateViews();
        });
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
    }

    enable() {
        this._connect(Main.layoutManager, "monitors-changed", () => this._rebuildViews());
        this._connect(this._themeContext, "notify::scale-factor", () => this._rebuildViews());
        PANEL_KEYS.forEach(key =>
            this._connect(global.settings, "changed::" + key, () => this._queueRebuild()));
        this._rebuildViews();
        this.tracker.enable();
    }

    disable() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        this.tracker.disable();
        this._signals.forEach(([object, id]) => object.disconnect(id));
        this._signals = [];
        this.views.forEach(view => view.destroy());
        this.views = [];
        this.settings.destroy();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
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
        const position = "bottom";
        this.views = Main.layoutManager.monitors.map(monitor =>
            new DockView(monitor, position, scale, this._panelInset(monitor.index, position)));
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
                    entries.push(Object.assign({}, item, { facts: facts }));
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
