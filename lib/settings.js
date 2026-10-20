// DockSettings (SPEC §9): persistent settings from settings-schema.json.

const Settings = imports.ui.settings;

class DockSettings {
    // callbacks: { pinnedApps(), position(), focusHotkey(), autohide() }, called on
    // external changes.
    constructor(uuid, callbacks) {
        this.pinnedApps = [];
        this.position = "bottom";
        this.focusHotkey = "";
        this.autohide = false;
        this._settings = new Settings.ExtensionSettings(this, uuid);
        this._settings.bind("pinned-apps", "pinnedApps", callbacks.pinnedApps);
        this._settings.bind("position", "position", callbacks.position);
        this._settings.bind("focus-hotkey", "focusHotkey", callbacks.focusHotkey);
        this._settings.bind("autohide", "autohide", callbacks.autohide);
    }

    setPinnedApps(desktopIds) {
        this._settings.setValue("pinned-apps", desktopIds);
    }

    destroy() {
        this._settings.finalize();
        this._settings = null;
    }
}
