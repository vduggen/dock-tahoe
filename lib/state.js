// State model (SPEC §4): independent, combinable flags instead of one enum.
// An app can be pinned, running, minimized and badged at the same time.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

var AppFlag = Object.freeze({
    PINNED: 1 << 0,
    RUNNING: 1 << 1,
    // Foreground app; distinct from RUNNING, which alone never means focus.
    FOCUSED: 1 << 2,
    LAUNCHING: 1 << 3,
    MINIMIZED: 1 << 4,
    ATTENTION: 1 << 5,
    BADGED: 1 << 6,
    DRAGGING: 1 << 7,
    DROP_TARGET: 1 << 8,
    CONTEXT_MENU_OPEN: 1 << 9
});

var DockFlag = Object.freeze({
    VISIBLE: 1 << 0,
    ENTERING: 1 << 1,
    LEAVING: 1 << 2,
    HOVER: 1 << 3,
    MAGNIFICATION: 1 << 4,
    VERTICAL: 1 << 5,
    MENU_OPEN: 1 << 6,
    FULLSCREEN: 1 << 7,
    DARK: 1 << 8,
    REDUCED_MOTION: 1 << 9
});

function has(flags, flag) {
    return (flags & flag) === flag;
}

function set(flags, flag, enabled) {
    return enabled ? flags | flag : flags & ~flag;
}

// Readable flag names for logs and tests, e.g. "PINNED|RUNNING".
function describe(flags, table) {
    return Object.keys(table).filter(name => has(flags, table[name])).join("|") || "NONE";
}
