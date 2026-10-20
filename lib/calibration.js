// Calibration mode (SPEC §9 "Desenvolvimento"): settings that override
// tokens, timing and the glass shadow while tuning against Tahoe captures.
// Their section in the settings window shows only while the hidden
// `calibration` key is on (scripts/calibration.sh), so end users never see
// it. Each key's schema default is the value it overrides.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

// Setting key -> token (lib/tokens.js), in logical px at the default icon
// size; the proportional ones still follow the icon size.
var TOKENS = {
    "cal-icon-gap": "icon.gap",
    "cal-padding-x": "dock.paddingX",
    "cal-padding-y": "dock.paddingY",
    "cal-bottom-offset": "dock.bottomOffset",
    "cal-corner-radius": "dock.cornerRadius",
    "cal-indicator-diameter": "indicator.diameter",
    "cal-indicator-edge-gap": "indicator.edgeGap",
    "cal-separator-height": "separator.height",
    "cal-magnification-sigma": "magnification.sigma",
    "cal-blur-radius": "glass.blurRadius",
    "cal-refraction": "glass.refraction"
};

// Setting key -> Animation.TIMING key (lib/animation.js); percents are
// stored as fractions.
var TIMING = {
    "cal-hover-ms": "hoverMs",
    "cal-pointer-ms": "pointerMs",
    "cal-reorder-ms": "reorderMs",
    "cal-reveal-ms": "revealMs",
    "cal-bounce-ms": "bounceMs",
    "cal-bounce-height": "bounceHeight",
    "cal-reorder-power": "reorderPower"
};
var PERCENT = ["cal-bounce-height", "cal-shadow-opacity"];

// The .tahoe-dock box-shadow (stylesheet.css), in logical px. y + blur must
// stay within GLASS_SHADOW (lib/dockView.js).
var SHADOW = { "cal-shadow-y": "y", "cal-shadow-blur": "blur", "cal-shadow-opacity": "opacity" };

var KEYS = Object.keys(TOKENS).concat(Object.keys(TIMING), Object.keys(SHADOW));

// values: setting key -> value. { tokens, timing, shadow } for the keys
// present; shadow is null when none is.
function tuning(values) {
    const result = { tokens: {}, timing: {}, shadow: null };
    const read = key => PERCENT.indexOf(key) >= 0 ? values[key] / 100 : values[key];
    KEYS.forEach(key => {
        if (typeof values[key] !== "number")
            return;
        if (key in TOKENS)
            result.tokens[TOKENS[key]] = read(key);
        else if (key in TIMING)
            result.timing[TIMING[key]] = read(key);
        else
            (result.shadow = result.shadow || {})[SHADOW[key]] = read(key);
    });
    return result;
}
