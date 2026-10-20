// Outline of the macOS dock bubble shared by the tooltip and the context
// menu: a rounded body and a soft arrow whose tip points at the icon.
//
// The path is built for an arrow on the bottom edge, in a frame `length`
// wide (along the edge) and `depth` tall; transform() turns that frame onto
// the real side. Segments are plain arrays the Cairo code replays:
//   ["move", x, y] ["line", x, y] ["arc", cx, cy, r, from, to]
//   ["curve", x1, y1, x2, y2, x, y] ["close"]
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

// Edge the arrow sits on, for each dock position: the side facing the dock.
var ARROW_SIDES = Object.freeze({ bottom: "bottom", left: "left", right: "right" });

// The canonical frame for a `width` × `height` actor.
function frame(width, height, side) {
    return side === "bottom" ? { length: width, depth: height } : { length: height, depth: width };
}

// Cairo translate + rotate from the canonical frame to the actor.
function transform(width, height, side) {
    if (side === "left")
        return { x: width, y: 0, angle: Math.PI / 2 };
    if (side === "right")
        return { x: 0, y: height, angle: -Math.PI / 2 };
    return { x: 0, y: 0, angle: 0 };
}

// Tip position along the edge, measured in the actor (x for bottom, y for
// the sides), turned into the canonical frame.
function canonicalTip(tip, width, height, side) {
    return side === "right" ? height - tip : tip;
}

// Keeps the arrow off the rounded corners.
function clampTip(tip, length, radius, arrowWidth) {
    const low = radius + arrowWidth / 2;
    const high = length - radius - arrowWidth / 2;
    if (low > high)
        return length / 2;
    return Math.min(high, Math.max(low, tip));
}

// metrics: { radius, arrowWidth, arrowHeight }, in the actor's pixels.
function outline(length, depth, tip, metrics) {
    const bottom = depth - metrics.arrowHeight;
    const r = Math.max(0, Math.min(metrics.radius, length / 2, bottom / 2));
    const half = metrics.arrowWidth / 2;
    const at = clampTip(tip, length, r, metrics.arrowWidth);
    return [
        ["move", r, 0],
        ["line", length - r, 0],
        ["arc", length - r, r, r, -Math.PI / 2, 0],
        ["line", length, bottom - r],
        ["arc", length - r, bottom - r, r, 0, Math.PI / 2],
        ["line", at + half, bottom],
        // Concave shoulders into a rounded tip, as in the macOS Dock.
        ["curve", at + half * 0.6, bottom, at + half * 0.35, depth, at, depth],
        ["curve", at - half * 0.35, depth, at - half * 0.6, bottom, at - half, bottom],
        ["line", r, bottom],
        ["arc", r, bottom - r, r, Math.PI / 2, Math.PI],
        ["line", 0, r],
        ["arc", r, r, r, Math.PI, 3 * Math.PI / 2],
        ["close"]
    ];
}
