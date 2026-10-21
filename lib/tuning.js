// Appearance tuning from the settings: tokens, timing and shadow overrides
// (lib/calibration.js) for the icon size and magnification chosen. Shared by
// both platforms' DockSettings.

const Calibration = require("./lib/calibration.js");
const Tokens = require("./lib/tokens.js");

// Spacing calibrated as a share of the icon (lib/tokens.js), so it follows
// the icon size. The dot and the separator's 1 px stay as they are.
const PROPORTIONAL = ["icon.gap", "dock.paddingX", "dock.paddingY", "dock.cornerRadius",
    "separator.height", "magnification.sigma"];

// settings: a DockSettings. { tokens, timing, shadow }, with the
// calibration's values while it is on. Off, or set below the icon size,
// magnification keeps icons at their size.
function tuning(settings) {
    const result = Calibration.tuning(settings.calibration ? settings.calibrationValues : {});
    const tokens = Object.assign({}, Tokens.DEFAULTS, result.tokens);
    const base = settings.iconSize;
    result.tokens = Object.assign(result.tokens, {
        "icon.baseSize": base,
        "icon.maxSize": settings.magnification ? Math.max(base, settings.magnificationSize) : base
    });
    const factor = base / Tokens.DEFAULTS["icon.baseSize"];
    PROPORTIONAL.forEach(key => result.tokens[key] = tokens[key] * factor);
    return result;
}
