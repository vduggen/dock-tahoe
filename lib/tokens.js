// Design tokens from SPEC §2. Values are logical points and only starting
// points for calibration against real Tahoe captures.
//
// Pure module: top-level `var`/`function` only, so it loads both through
// Cinnamon's require() and through cjs `imports` in the tests.

var DEFAULTS = Object.freeze({
    "icon.baseSize": 48,
    "icon.maxSize": 72,
    // Spacing follows the user's macOS dock reference (110 px icons): the
    // gap, side and top padding are all ~30% of the icon (33-34 px), the
    // corner radius ~55% (60 px) and the running dot's center sits ~11% of
    // the icon (12 px) above the dock edge. Scaled to a 48 px icon. One value
    // for gap and padding keeps every icon evenly spaced (SPEC §2 said 7 / 10 / 8 / 20).
    "icon.gap": 14,
    "dock.paddingX": 14,
    "dock.paddingY": 14,
    "dock.bottomOffset": 5,
    "dock.cornerRadius": 26,
    // Reference dot is ~3.3 px at this size; 6 reads better on the
    // user's screens.
    "indicator.diameter": 6,
    // Not in SPEC §2: space between the pill's edge and the indicator; its
    // center lands 7 px above the edge, a light lift off the edge.
    "indicator.edgeGap": 4,
    "separator.width": 1,
    "separator.height": 36,
    "glass.blurRadius": 20,
    // Not in SPEC §2: tooltip and menu bubble, after the user's macOS
    // reference (soft arrow about twice as wide as it is tall).
    "bubble.radius": 12,
    "bubble.arrowWidth": 22,
    "bubble.arrowHeight": 9,
    // Not in SPEC §2: Gaussian reach of the magnification (SPEC §5), about one
    // icon slot. To be calibrated against Tahoe recordings.
    "magnification.sigma": 60
});

// Merges overrides over DEFAULTS and converts logical points to physical
// pixels. Throws on unknown keys or invalid values so calibration typos fail
// loudly instead of silently keeping the default.
function resolve(overrides, scaleFactor) {
    const scale = scaleFactor === undefined ? 1 : scaleFactor;
    if (!(typeof scale === "number" && scale > 0 && isFinite(scale)))
        throw new Error("tokens: invalid scale factor " + scale);

    const merged = Object.assign({}, DEFAULTS);
    Object.keys(overrides || {}).forEach(key => {
        if (!(key in DEFAULTS))
            throw new Error("tokens: unknown token " + key);
        const value = overrides[key];
        if (!(typeof value === "number" && value >= 0 && isFinite(value)))
            throw new Error("tokens: invalid value for " + key + ": " + value);
        merged[key] = value;
    });

    if (merged["icon.maxSize"] < merged["icon.baseSize"])
        throw new Error("tokens: icon.maxSize must be >= icon.baseSize");

    const physical = {};
    Object.keys(merged).forEach(key => physical[key] = merged[key] * scale);
    return Object.freeze(physical);
}
