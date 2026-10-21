// Tahoe Dock — entry points called by Cinnamon's extension system. The dock
// itself is lib/controller.js; gnome/extension.js is GNOME Shell's entry.

const { DockController } = require("./lib/controller.js");
const { DockSettings } = require("./lib/settings.js");

let _metadata = null;
let _controller = null;

function init(metadata) {
    _metadata = metadata;
}

function enable() {
    _controller = new DockController(callbacks => new DockSettings(_metadata.uuid, callbacks));
    _controller.enable();
    global.log("Tahoe Dock v" + _metadata.version + " ativo");
}

function disable() {
    if (_controller) {
        _controller.disable();
        _controller = null;
    }
    global.log("Tahoe Dock v" + _metadata.version + " desativado");
}
