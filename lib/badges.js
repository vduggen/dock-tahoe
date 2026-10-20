// Badges (SPEC §4): the count an app shows on its dock icon, received through
// the com.canonical.Unity.LauncherEntry protocol that Plank and Dash to Dock
// also read (Telegram, Thunderbird, Electron apps and others send it).
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

// Longer counts would cover the icon; macOS truncates the same way.
var MAX_COUNT = 999;

// Geometry relative to the icon's side, measured on the user's macOS
// reference (110 px icon, 40 px tall badge).
var GEOMETRY = Object.freeze({
    height: 0.36,
    font: 0.24,
    // The badge's top-right corner overhangs the icon by this much.
    overhang: 0.06
});

// "application://firefox.desktop" → "firefox" (lib/grouping.js normalizeId).
function desktopId(appUri) {
    const match = /^application:\/\/(.+)$/.exec(String(appUri || "").trim());
    return match ? match[1].trim().toLowerCase().replace(/\.desktop$/, "") : "";
}

// Merges an Update's properties into the previous state; an app may send
// `count` and `count-visible` separately.
function merge(previous, properties) {
    const state = Object.assign({ count: 0, visible: false }, previous);
    if (typeof properties.count === "number" && isFinite(properties.count))
        state.count = Math.max(0, Math.round(properties.count));
    if (typeof properties["count-visible"] === "boolean")
        state.visible = properties["count-visible"];
    return state;
}

// The text to draw, or null when there is no badge.
function label(state) {
    if (!state || !state.visible || state.count <= 0)
        return null;
    return state.count > MAX_COUNT ? MAX_COUNT + "+" : String(state.count);
}
