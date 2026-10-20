// DockSettings (SPEC §9): persistent settings from settings-schema.json.

const Settings = imports.ui.settings;

const Tokens = require("./lib/tokens.js");

// Spacing calibrated as a share of the icon (lib/tokens.js), so it follows
// the icon size. The dot and the separator's 1 px stay as they are.
const PROPORTIONAL = ["icon.gap", "dock.paddingX", "dock.paddingY", "dock.cornerRadius",
    "separator.height", "magnification.sigma"];

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
        this.iconAppearance = "default";
        this.iconTint = "rgb(10,132,255)";
        this.recentApps = [];
        this.showRecentApps = true;
        this.minimizeIntoIcon = true;
        this.showDownloads = true;
        this.folders = [];
        this.stackOptions = {};
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
        this._settings.bind("icon-appearance", "iconAppearance", callbacks.appearance);
        this._settings.bind("icon-tint", "iconTint", callbacks.appearance);
        this._settings.bind("recent-apps", "recentApps", callbacks.recent);
        this._settings.bind("show-recent-apps", "showRecentApps", callbacks.recent);
        this._settings.bind("minimize-into-icon", "minimizeIntoIcon", callbacks.recent);
        this._settings.bind("show-downloads", "showDownloads", callbacks.folders);
        this._settings.bind("folders", "folders", callbacks.folders);
        this._settings.bind("stack-options", "stackOptions", callbacks.recent);
    }

    // Token overrides (lib/tokens.js) for the appearance settings. Off, or
    // set below the icon size, magnification keeps icons at their size.
    tokenOverrides() {
        const base = this.iconSize;
        const overrides = {
            "icon.baseSize": base,
            "icon.maxSize": this.magnification ? Math.max(base, this.magnificationSize) : base
        };
        const factor = base / Tokens.DEFAULTS["icon.baseSize"];
        PROPORTIONAL.forEach(key => overrides[key] = Tokens.DEFAULTS[key] * factor);
        return overrides;
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
