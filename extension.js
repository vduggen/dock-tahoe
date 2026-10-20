// Dock Tahoe — entry points called by Cinnamon's extension system.

let _version = "dev";

function init(metadata) {
    _version = String(metadata.version || "dev");
}

function enable() {
    global.log("Dock Tahoe v" + _version + " ativo");
}

function disable() {
    global.log("Dock Tahoe v" + _version + " desativado");
}
