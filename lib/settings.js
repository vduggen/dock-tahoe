// DockSettings (SPEC §9): persistent settings from settings-schema.json,
// through Cinnamon's ExtensionSettings. gnome/lib/settings.js is the GSettings
// version for GNOME Shell, with the same properties and setters.

const Settings = imports.ui.settings;

const Calibration = require("./lib/calibration.js");
const Tuning = require("./lib/tuning.js");

class DockSettings {
    // callbacks: { pinnedApps(), position(), focusHotkey(), autohide(),
    // appearance(), workspaces(), recent(), folders() }, called on external
    // changes.
    constructor(uuid, callbacks) {
        this.pinnedApps = [];
        this.position = "bottom";
        this.focusHotkey = "";
        this.autohide = false;
        this.currentWorkspaceOnly = false;
        this.iconSize = 48;
        this.magnification = true;
        this.magnificationSize = 72;
        this.glassBlur = false;
        // "fast" or "high" (lib/glassBlur.js).
        this.glassQuality = "fast";
        this.iconAppearance = "default";
        this.iconTint = "rgb(10,132,255)";
        this.recentApps = [];
        this.showRecentApps = true;
        this.minimizeIntoIcon = true;
        this.showDownloads = true;
        this.folders = [];
        this.stackOptions = {};
        this.calibration = false;
        // Calibration values by setting key (lib/calibration.js).
        this.calibrationValues = {};
        this._settings = new Settings.ExtensionSettings(this, uuid);
        this._settings.bind("pinned-apps", "pinnedApps", callbacks.pinnedApps);
        this._settings.bind("position", "position", callbacks.position);
        this._settings.bind("focus-hotkey", "focusHotkey", callbacks.focusHotkey);
        this._settings.bind("autohide", "autohide", callbacks.autohide);
        this._settings.bind("current-workspace-only", "currentWorkspaceOnly", callbacks.workspaces);
        this._settings.bind("icon-size", "iconSize", callbacks.appearance);
        this._settings.bind("magnification", "magnification", callbacks.appearance);
        this._settings.bind("magnification-size", "magnificationSize", callbacks.appearance);
        this._settings.bind("glass-blur", "glassBlur", callbacks.appearance);
        this._settings.bind("glass-quality", "glassQuality", callbacks.appearance);
        this._settings.bind("icon-appearance", "iconAppearance", callbacks.appearance);
        this._settings.bind("icon-tint", "iconTint", callbacks.appearance);
        this._settings.bind("recent-apps", "recentApps", callbacks.recent);
        this._settings.bind("show-recent-apps", "showRecentApps", callbacks.recent);
        this._settings.bind("minimize-into-icon", "minimizeIntoIcon", callbacks.recent);
        this._settings.bind("show-downloads", "showDownloads", callbacks.folders);
        this._settings.bind("folders", "folders", callbacks.folders);
        this._settings.bind("stack-options", "stackOptions", callbacks.recent);
        this._settings.bind("calibration", "calibration", callbacks.appearance);
        Calibration.KEYS.forEach(key => {
            this.calibrationValues[key] = this._settings.getValue(key);
            this._settings.connect("changed::" + key, () => {
                this.calibrationValues[key] = this._settings.getValue(key);
                if (this.calibration)
                    callbacks.appearance();
            });
        });
    }

    // { tokens, timing, shadow } overrides for the appearance settings
    // (lib/tuning.js).
    tuning() {
        return Tuning.tuning(this);
    }

    setPinnedApps(desktopIds) {
        this._settings.setValue("pinned-apps", desktopIds);
    }

    setRecentApps(desktopIds) {
        this._settings.setValue("recent-apps", desktopIds);
    }

    setShowDownloads(show) {
        this._settings.setValue("show-downloads", show);
    }

    setFolders(rows) {
        this._settings.setValue("folders", rows);
    }

    setStackOptions(options) {
        this._settings.setValue("stack-options", options);
    }

    destroy() {
        this._settings.finalize();
        this._settings = null;
    }
}
