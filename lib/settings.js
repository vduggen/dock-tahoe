// DockSettings (SPEC §9): persistent settings from settings-schema.json.

const Settings = imports.ui.settings;

class DockSettings {
    constructor(uuid, onChanged) {
        this.pinnedApps = [];
        this._settings = new Settings.ExtensionSettings(this, uuid);
        this._settings.bind("pinned-apps", "pinnedApps", onChanged);
    }

    destroy() {
        this._settings.finalize();
        this._settings = null;
    }
}
