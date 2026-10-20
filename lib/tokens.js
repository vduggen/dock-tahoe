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
    // for gap and padding keeps every icon, and the focused highlight, evenly
    // spaced (SPEC §2 said 7 / 10 / 8 / 20).
    "icon.gap": 14,
    "dock.paddingX": 14,
    "dock.paddingY": 14,
    "dock.bottomOffset": 5,
    "dock.cornerRadius": 26,
    // Reference dot is ~3.3 px at this size; 4 is the smallest that St
    // still draws as a round dot.
    "indicator.diameter": 4,
    // Not in SPEC §2: space between the pill's edge and the indicator. The
    // dot sits in the band left below the focused highlight (14 - 7 = 7 px),
    // clear of it, close to the reference's ~5 px center.
    "indicator.edgeGap": 2,
    // Not in SPEC §2: how far the focused-app highlight extends around the
    // icon. Half the padding, so the icon has as much space inside the
    // highlight as the highlight has to the edge and its neighbors; any
    // other split makes the focused icon look cramped next to the rest.
    "highlight.inset": 7,
    "separator.width": 1,
    "separator.height": 36,
    "glass.blurRadius": 20,
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
