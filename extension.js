// Dock Tahoe — entry points called by Cinnamon's extension system.

const St = imports.gi.St;
const Main = imports.ui.main;

const { AppTracker } = require("./lib/appTracker.js");
const { DockSettings } = require("./lib/settings.js");
const { DockView } = require("./lib/dockView.js");
const Grouping = require("./lib/grouping.js");

let _metadata = null;
let _controller = null;

class DockController {
    constructor(metadata) {
        this.views = [];
        this._signals = [];
        this._snapshot = { items: [] };
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
        this._rebuildViews();
        this.tracker.enable();
    }

    disable() {
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

    _rebuildViews() {
        this.views.forEach(view => view.destroy());
        const scale = this._themeContext.scale_factor;
        this.views = Main.layoutManager.monitors.map(monitor => new DockView(monitor, "bottom", scale));
        this._updateViews();
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
