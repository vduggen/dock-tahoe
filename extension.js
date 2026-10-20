// Dock Tahoe — entry points called by Cinnamon's extension system.

const { AppTracker } = require("./lib/appTracker.js");
const { DockSettings } = require("./lib/settings.js");
const Grouping = require("./lib/grouping.js");
const State = require("./lib/state.js");

let _metadata = null;
let _controller = null;

class DockController {
    constructor(metadata) {
        this._lastSummary = "";
        this.settings = new DockSettings(metadata.uuid, () => this.tracker.reloadPinned());
        this.tracker = new AppTracker(() => this.settings.pinnedApps, snapshot => this._update(snapshot));
    }

    enable() {
        this.tracker.enable();
    }

    disable() {
        this.tracker.disable();
        this.settings.destroy();
    }

    // Until the dock view lands (stage 3), report item states in the log.
    _update(snapshot) {
        const summary = snapshot.items.map(item =>
            item.key + "[" + State.describe(State.fromFacts(Grouping.facts(item)), State.AppFlag) + "]"
        ).join(" ");
        if (summary === this._lastSummary)
            return;
        this._lastSummary = summary;
        global.log("Dock Tahoe: " + summary);
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
