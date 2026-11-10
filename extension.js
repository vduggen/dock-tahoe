// Tahoe Dock — entry points called by Cinnamon's extension system. The dock
// itself is lib/controller.js; gnome/extension.js is GNOME Shell's entry.

const { DockController } = require("./lib/controller.js");
const { DockSettings } = require("./lib/settings.js");
const GLib = imports.gi.GLib;
const Main = imports.ui.main;

let _metadata = null;
let _controller = null;

function init(metadata) {
    _metadata = metadata;
}

function enable() {
    _controller = new DockController(callbacks => new DockSettings(_metadata.uuid, callbacks));
    _controller.enable();
    global.log("Tahoe Dock v" + _metadata.version + " ativo");
    return { updateExtension, reloadExtension };
}

function reloadExtension() {
    try {
        GLib.spawn_async(null, ["python3", _metadata.path + "/scripts/update.py", "cinnamon", "--reload"],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (error) {
        Main.notifyError("Tahoe Dock", "Não foi possível abrir a recarga: " + error.message);
    }
}

function updateExtension() {
    try {
        GLib.spawn_async(null, ["python3", _metadata.path + "/scripts/update.py", "cinnamon"],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
    } catch (error) {
        Main.notifyError("Tahoe Dock", "Não foi possível abrir o atualizador: " + error.message);
    }
}

function disable() {
    if (_controller) {
        _controller.disable();
        _controller = null;
    }
    global.log("Tahoe Dock v" + _metadata.version + " desativado");
}
