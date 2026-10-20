// DockSettings (SPEC §9): persistent settings from settings-schema.json.

const Settings = imports.ui.settings;

const Tokens = require("./lib/tokens.js");

// Spacing calibrated as a share of the icon (lib/tokens.js), so it follows
// the icon size. The dot and the separator's 1 px stay as they are.
const PROPORTIONAL = ["icon.gap", "dock.paddingX", "dock.paddingY", "dock.cornerRadius",
    "separator.height", "magnification.sigma"];

class DockSettings {
    // callbacks: { pinnedApps(), position(), focusHotkey(), autohide(),
    // appearance(), workspaces() }, called on external changes.
    constructor(uuid, callbacks) {
        this.pinnedApps = [];
        this.position = "bottom";
        this.focusHotkey = "";
        this.autohide = false;
        this.currentWorkspaceOnly = false;
        this.iconSize = 48;
        this.magnification = true;
        this.magnificationSize = 72;
        this._settings = new Settings.ExtensionSettings(this, uuid);
        this._settings.bind("pinned-apps", "pinnedApps", callbacks.pinnedApps);
        this._settings.bind("position", "position", callbacks.position);
        this._settings.bind("focus-hotkey", "focusHotkey", callbacks.focusHotkey);
        this._settings.bind("autohide", "autohide", callbacks.autohide);
        this._settings.bind("current-workspace-only", "currentWorkspaceOnly", callbacks.workspaces);
        this._settings.bind("icon-size", "iconSize", callbacks.appearance);
        this._settings.bind("magnification", "magnification", callbacks.appearance);
        this._settings.bind("magnification-size", "magnificationSize", callbacks.appearance);
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

    destroy() {
        this._settings.finalize();
        this._settings = null;
    }
}
