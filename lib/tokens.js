// Design tokens from SPEC §2. Values are logical points and only starting
// points for calibration against real Tahoe captures.
//
// Pure module: top-level `var`/`function` only, so it loads both through
// Cinnamon's require() and through cjs `imports` in the tests.

var DEFAULTS = Object.freeze({
    "icon.baseSize": 48,
    "icon.maxSize": 72,
    "icon.gap": 7,
    // SPEC §2 says 10; matched to paddingY so the corner radii stay
    // concentric at the dock's ends too (Layout.radii).
    "dock.paddingX": 8,
    "dock.paddingY": 8,
    "dock.bottomOffset": 5,
    "dock.cornerRadius": 20,
    "indicator.diameter": 4,
    // Not in SPEC §2: space between the pill's edge and the indicator, so the
    // dot does not sit flush with the bottom.
    "indicator.edgeGap": 4,
    // Not in SPEC §2: how far the focused-app highlight extends around the
    // icon.
    "highlight.inset": 4,
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
