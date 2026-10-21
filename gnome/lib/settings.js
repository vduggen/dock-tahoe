// DockSettings (SPEC §9), GNOME Shell side: the same properties and setters
// as lib/settings.js, kept in GSettings. The schema is built from
// settings-schema.json (scripts/build-gnome.js); keys Cinnamon stores as
// lists of rows or objects are stored as string arrays and JSON here.

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as Calibration from "./calibration.js";
import * as Tuning from "./tuning.js";

// Setting key -> [property, callback], as lib/settings.js binds them.
const BINDINGS = {
    "pinned-apps": ["pinnedApps", "pinnedApps"],
    "position": ["position", "position"],
    "focus-hotkey": ["focusHotkey", "focusHotkey"],
    "autohide": ["autohide", "autohide"],
    "current-workspace-only": ["currentWorkspaceOnly", "workspaces"],
    "icon-size": ["iconSize", "appearance"],
    "magnification": ["magnification", "appearance"],
    "magnification-size": ["magnificationSize", "appearance"],
    "glass-blur": ["glassBlur", "appearance"],
    "glass-quality": ["glassQuality", "appearance"],
    "icon-appearance": ["iconAppearance", "appearance"],
    "icon-tint": ["iconTint", "appearance"],
    "recent-apps": ["recentApps", "recent"],
    "show-recent-apps": ["showRecentApps", "recent"],
    "minimize-into-icon": ["minimizeIntoIcon", "recent"],
    "show-downloads": ["showDownloads", "folders"],
    "folders": ["folders", "folders"],
    "stack-options": ["stackOptions", "recent"],
    "calibration": ["calibration", "appearance"]
};

export class DockSettings {
    // gsettings: the extension's Gio.Settings. callbacks: as in
    // lib/settings.js, called on external changes.
    constructor(gsettings, callbacks) {
        this.gsettings = gsettings;
        // Calibration values by setting key (lib/calibration.js).
        this.calibrationValues = {};
        this._ids = [];
        this._seedPinned();
        Object.keys(BINDINGS).forEach(key => {
            const [property, callback] = BINDINGS[key];
            this[property] = this._read(key);
            this._ids.push(gsettings.connect("changed::" + key, () => {
                const value = this._read(key);
                // Our own writes already updated the property.
                if (JSON.stringify(value) === JSON.stringify(this[property]))
                    return;
                this[property] = value;
                callbacks[callback]();
            }));
        });
        Calibration.KEYS.forEach(key => {
            this.calibrationValues[key] = gsettings.get_int(key);
            this._ids.push(gsettings.connect("changed::" + key, () => {
                this.calibrationValues[key] = gsettings.get_int(key);
                if (this.calibration)
                    callbacks.appearance();
            }));
        });
    }

    // The first time, the dock starts from the shell's favorites, with the
    // file manager in front, as Finder leads the macOS Dock.
    _seedPinned() {
        if (this.gsettings.get_user_value("pinned-apps") !== null)
            return;
        const favorites = new Gio.Settings({ schema_id: "org.gnome.shell" }).get_strv("favorite-apps");
        const manager = Gio.AppInfo.get_default_for_type("inode/directory", false);
        const first = manager && manager.get_id() ? [manager.get_id()] : [];
        this.gsettings.set_strv("pinned-apps", first.concat(favorites.filter(id => first.indexOf(id) < 0)));
    }

    // The value as lib/settings.js holds it.
    _read(key) {
        if (key === "focus-hotkey")
            return this.gsettings.get_strv(key)[0] || "";
        if (key === "folders")
            return this.gsettings.get_strv(key).map(uri => ({ uri: uri }));
        if (key === "stack-options") {
            try {
                return JSON.parse(this.gsettings.get_string(key)) || {};
            } catch (e) {
                return {};
            }
        }
        return this.gsettings.get_value(key).recursiveUnpack();
    }

    _write(key, value) {
        this[BINDINGS[key][0]] = value;
        if (key === "folders")
            this.gsettings.set_strv(key, value.map(row => row && row.uri).filter(Boolean));
        else if (key === "stack-options")
            this.gsettings.set_string(key, JSON.stringify(value));
        else
            this.gsettings.set_value(key, new GLib.Variant(
                this.gsettings.get_value(key).get_type_string(), value));
    }

    // { tokens, timing, shadow } overrides for the appearance settings
    // (lib/tuning.js).
    tuning() {
        return Tuning.tuning(this);
    }

    setPinnedApps(desktopIds) {
        this._write("pinned-apps", desktopIds);
    }

    setRecentApps(desktopIds) {
        this._write("recent-apps", desktopIds);
    }

    setShowDownloads(show) {
        this._write("show-downloads", show);
    }

    setFolders(rows) {
        this._write("folders", rows);
    }

    setStackOptions(options) {
        this._write("stack-options", options);
    }

    destroy() {
        this._ids.forEach(id => this.gsettings.disconnect(id));
        this._ids = [];
        this.gsettings = null;
    }
}
