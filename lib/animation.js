// AnimationEngine math (SPEC §6): frame-rate independent smoothing, the
// bounce curve and easing. The view drives these from one Clutter timeline,
// so every transition can change its destination mid-way without restarting.
//
// Durations are SPEC §6 starting points, not measured Tahoe values.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

var TIMING = Object.freeze({
    // Enter and leave magnification: ~95% of the way in this time (§6: 160–240).
    hoverMs: 200,
    // Pointer smoothing, so fast moves never make sizes jump (§5 item 7).
    pointerMs: 40,
    // Add, remove and reorder (§6: 180–260).
    reorderMs: 220,
    // Show and hide the dock (§6: 220–300).
    revealMs: 260,
    // Auto-hide waits this long after the pointer leaves before hiding.
    hideDelayMs: 300,
    // One bounce; height as a fraction of the base icon size.
    bounceMs: 600,
    bounceHeight: 0.5,
    // Attention bounces this many times each time an app asks for it.
    attentionBounces: 3,
    // A launch bounces until a window shows up, at most this long.
    launchTimeoutMs: 10000
});

// Exponential approach to `target`. Reaches ~95% after `durationMs` whatever
// the frame rate, and a new target simply redirects it. A zero duration
// (reduced motion) jumps straight to the target.
function approach(current, target, dtMs, durationMs) {
    if (!(durationMs > 0) || current === null || current === undefined)
        return target;
    return target + (current - target) * Math.exp(-3 * dtMs / durationMs);
}

function settled(current, target, epsilon) {
    return Math.abs(current - target) <= (epsilon === undefined ? 1e-3 : epsilon);
}

function easeOutCubic(t) {
    const clamped = Math.min(1, Math.max(0, t));
    return 1 - Math.pow(1 - clamped, 3);
}

function lerp(from, to, t) {
    return from + (to - from) * t;
}

// Height of a bounce `elapsedMs` after it began, as a fraction of its peak:
// a gravity parabola per bounce, 0 at take-off and landing, 1 at the top.
// Returns 0 once `count` bounces are done.
function bounce(elapsedMs, periodMs, count) {
    if (elapsedMs < 0 || elapsedMs >= periodMs * count)
        return 0;
    const phase = (elapsedMs % periodMs) / periodMs;
    return 4 * phase * (1 - phase);
}
