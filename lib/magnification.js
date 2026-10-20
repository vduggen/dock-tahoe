// MagnificationEngine (SPEC §5): icon sizes from the pointer position.
//
// The Gaussian falloff is an implementation hypothesis, not the confirmed
// macOS curve; sigma and the sizes are calibration tokens.
//
// Distances are measured to each icon's *rest* center, not to its magnified
// position, so the result does not feed back into the layout and cannot
// oscillate while the pointer moves.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

function influence(distance, sigma) {
    const ratio = distance / sigma;
    return Math.exp(-0.5 * ratio * ratio);
}

// centers: rest centers on the main axis, one per element; `null` marks an
// element that never magnifies (a separator) and yields `null`.
// pointer: main-axis pointer coordinate, or null when outside the dock.
// amount: 0..1 progress of the enter/leave transition.
function sizes(centers, pointer, baseSize, maxSize, sigma, amount) {
    const progress = amount === undefined ? 1 : Math.min(1, Math.max(0, amount));
    const extra = Math.max(0, maxSize - baseSize) * progress;
    return centers.map(center => {
        if (center === null)
            return null;
        if (pointer === null || extra === 0)
            return baseSize;
        return baseSize + extra * influence(Math.abs(pointer - center), sigma);
    });
}
