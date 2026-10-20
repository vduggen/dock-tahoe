// Folder stacks (SPEC "Pastas e Lixeira"): a folder's view and order, as
// its context menu sets them, and where its items go when it opens.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

// "auto" opens the fan while the items fit in it, else the grid, as the
// macOS Dock does.
var VIEWS = ["auto", "fan", "grid", "list"];
var SORTS = ["name", "modified", "created", "kind"];
// The fan holds this many items at most; the rest are left to the file
// manager.
var FAN_MAX = 12;
// Main-axis shift of the fan's farthest item, as a share of its height: the
// fan bends away from the icon as it rises. Items are not tilted, as the
// Tahoe fan is: Clutter resamples rotated text and icons, which blurs them.
var FAN_BEND = 0.12;
var GRID_MAX_COLUMNS = 7;

// A folder's saved { view, sort }, invalid values reset. Downloads opens
// newest first, as in the macOS Dock; other folders by name.
function options(saved, downloads) {
    const view = saved && VIEWS.indexOf(saved.view) >= 0 ? saved.view : "auto";
    const sort = saved && SORTS.indexOf(saved.sort) >= 0 ? saved.sort : downloads ? "modified" : "name";
    return { view: view, sort: sort };
}

// items: [{ name, directory, kind, modified, created }], times in seconds.
// A new array: by name, newest first, or by kind, folders first; names
// break ties.
function sortItems(items, sort) {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    const compare = {
        name: byName,
        modified: (a, b) => (b.modified || 0) - (a.modified || 0) || byName(a, b),
        created: (a, b) => (b.created || 0) - (a.created || 0) || byName(a, b),
        kind: (a, b) => Number(b.directory) - Number(a.directory) ||
            String(a.kind || "").localeCompare(String(b.kind || "")) || byName(a, b)
    }[sort] || byName;
    return items.slice().sort(compare);
}

// The view a stack of `count` items opens in. The fan rises from a dock at
// the bottom only; elsewhere it is the grid.
function resolveView(view, count, position) {
    if (view === "auto")
        view = count <= FAN_MAX ? "fan" : "grid";
    return view === "fan" && position !== "bottom" ? "grid" : view;
}

// Fan slots for `count` items, nearest the icon first: { x, y } of
// each item's center from the icon's top center, `step` apart; up is -y.
function fanSlots(count, step) {
    const slots = [];
    for (let index = 0; index < Math.min(count, FAN_MAX); index++) {
        const t = index / (FAN_MAX - 1);
        slots.push({
            x: FAN_BEND * FAN_MAX * step * t * t,
            y: -(index + 0.5) * step
        });
    }
    return slots;
}

// { columns, rows } of a grid of `count` items: as square as it gets, up to
// GRID_MAX_COLUMNS wide.
function gridShape(count) {
    const columns = Math.max(1, Math.min(GRID_MAX_COLUMNS, Math.ceil(Math.sqrt(count))));
    return { columns: columns, rows: Math.ceil(count / columns) };
}
