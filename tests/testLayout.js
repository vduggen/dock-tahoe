const Layout = imports.lib.layout;
const Tokens = imports.lib.tokens;

const MONITOR = { x: 1920, y: 0, width: 1920, height: 1080 };
const KINDS = ["icon", "icon", "icon", "separator", "icon", "icon"];
const EPSILON = 1e-6;

function mainOf(rect, position) {
    return position === "bottom"
        ? [rect.x, rect.x + rect.width]
        : [rect.y, rect.y + rect.height];
}

function edgeDistance(rect, position, monitor) {
    if (position === "bottom")
        return monitor.y + monitor.height - (rect.y + rect.height);
    if (position === "left")
        return rect.x - monitor.x;
    return monitor.x + monitor.width - (rect.x + rect.width);
}

function inside(rect, monitor) {
    return rect.x >= monitor.x - EPSILON && rect.y >= monitor.y - EPSILON &&
        rect.x + rect.width <= monitor.x + monitor.width + EPSILON &&
        rect.y + rect.height <= monitor.y + monitor.height + EPSILON;
}

// Integrity invariants from SPEC §1 and §10, checked on every placement.
function checkIntegrity(assert, placed, monitor, label) {
    const position = placed.position;
    let previousEnd = -Infinity;
    placed.items.forEach((item, index) => {
        const [start, end] = mainOf(item.rect, position);
        assert.ok(start >= previousEnd - EPSILON, label + ": overlap at " + index);
        previousEnd = end;
        assert.ok(inside(item.rect, monitor), label + ": item " + index + " off screen");
    });
    assert.ok(inside(placed.dock, monitor), label + ": dock off screen");

    const icons = placed.items.filter(item => item.kind === "icon");
    const base = edgeDistance(icons[0].rect, position, monitor);
    icons.forEach((icon, index) => {
        assert.near(edgeDistance(icon.rect, position, monitor), base, EPSILON,
            label + ": base of icon " + index);
        const [start, end] = mainOf(icon.rect, position);
        const center = position === "bottom" ? icon.indicator.center.x : icon.indicator.center.y;
        assert.near(center, (start + end) / 2, EPSILON, label + ": indicator " + index);
    });
}

var tests = {
    "a dragged icon moves only past a neighbour's center"(assert) {
        const others = [100, 300];
        assert.equal(Layout.dropIndex(others, 50), 0);
        assert.equal(Layout.dropIndex(others, 250), 1, "between stays put");
        assert.equal(Layout.dropIndex(others, 310), 2, "past the last");
        assert.equal(Layout.dropIndex([], 10), 0, "alone");
    },

    "rest dock is centered with token spacing"(assert) {
        const tokens = Tokens.resolve();
        const rest = Layout.computeRest(KINDS, tokens, MONITOR, "bottom");
        assert.equal(rest.ratio, 1);
        // 2·14 padding + 5·48 icons + 1 separator + 5·14 gaps
        assert.equal(rest.length, 28 + 240 + 1 + 70);
        const placed = Layout.place(rest, null, null);
        assert.near(placed.dock.x + placed.dock.width / 2, MONITOR.x + MONITOR.width / 2,
            0.5, "centered within half a pixel");
        assert.equal(placed.dock.height, 48 + 2 * 14);
        assert.equal(edgeDistance(placed.dock, "bottom", MONITOR), 5);
        checkIntegrity(assert, placed, MONITOR, "rest");
    },

    "separator is centered in the dock and proportional"(assert) {
        const rest = Layout.computeRest(KINDS, Tokens.resolve(), MONITOR, "bottom");
        const separator = Layout.place(rest, null, null).items[3];
        assert.equal(separator.kind, "separator");
        assert.equal(separator.rect.height, 36);
        assert.near(edgeDistance(separator.rect, "bottom", MONITOR), 5 + (rest.crossLength - 36) / 2,
            EPSILON, "cross centered");
    },

    "every position keeps integrity at rest and magnified"(assert) {
        const tokens = Tokens.resolve();
        Layout.POSITIONS.forEach(position => {
            const rest = Layout.computeRest(KINDS, tokens, MONITOR, position);
            checkIntegrity(assert, Layout.place(rest, null, null), MONITOR, position);
            const sizes = KINDS.map(kind => kind === "icon" ? 72 : null);
            checkIntegrity(assert, Layout.place(rest, sizes, rest.centers[0]),
                MONITOR, position + " magnified");
        });
    },

    "vertical docks hug their edge"(assert) {
        const tokens = Tokens.resolve();
        const left = Layout.place(Layout.computeRest(KINDS, tokens, MONITOR, "left"), null, null);
        const right = Layout.place(Layout.computeRest(KINDS, tokens, MONITOR, "right"), null, null);
        assert.equal(left.dock.x, MONITOR.x + 5);
        assert.equal(right.dock.x + right.dock.width, MONITOR.x + MONITOR.width - 5);
        assert.near(left.dock.y + left.dock.height / 2, MONITOR.height / 2, 0.5, "centered within half a pixel");
    },

    "edge inset lifts the dock above a panel"(assert) {
        const tokens = Tokens.resolve();
        Layout.POSITIONS.forEach(position => {
            const rest = Layout.computeRest(KINDS, tokens, MONITOR, position, 52);
            const placed = Layout.place(rest, null, null);
            assert.equal(edgeDistance(placed.dock, position, MONITOR), 52 + 5, position);
            checkIntegrity(assert, placed, MONITOR, position + " inset");
        });
    },

    "indicator keeps its gap from the dock edge"(assert) {
        const tokens = Tokens.resolve();
        Layout.POSITIONS.forEach(position => {
            const placed = Layout.place(Layout.computeRest(KINDS, tokens, MONITOR, position, 52), null, null);
            const center = placed.items[0].indicator.center;
            const diameter = tokens["indicator.diameter"];
            const dot = { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter };
            assert.near(edgeDistance(dot, position, MONITOR) - edgeDistance(placed.dock, position, MONITOR),
                tokens["indicator.edgeGap"], EPSILON, position);
        });
    },

    "spacing is uniform around icons"(assert) {
        const tokens = Tokens.resolve();
        const placed = Layout.place(Layout.computeRest(["icon", "icon", "icon"], tokens, MONITOR, "bottom"), null, null);
        const [a, b, c] = placed.items.map(item => item.rect);
        const dock = placed.dock;
        const gaps = [a.x - dock.x, b.x - (a.x + a.width), c.x - (b.x + b.width),
            dock.x + dock.width - (c.x + c.width), a.y - dock.y, dock.y + dock.height - (a.y + a.height)];
        gaps.forEach((gap, index) => assert.near(gap, tokens["icon.gap"], EPSILON, "gap " + index));
    },

    "corner radii are concentric"(assert) {
        const tokens = Tokens.resolve({}, 2);
        const rest = Layout.computeRest(KINDS, tokens, MONITOR, "bottom");
        // Logical: 26 dock, 14 padding -> 26 - 14 = 12.
        const r = Layout.radii(rest);
        assert.equal(r.dock, 52);
        assert.equal(r.icon, 24);
        const shrunk = Layout.radii(Layout.computeRest(new Array(60).fill("icon"), tokens, MONITOR, "bottom"));
        assert.ok(shrunk.dock < r.dock && shrunk.icon < shrunk.dock, "shrinks with the dock");
    },

    "too many icons shrink to fit the monitor"(assert) {
        const tokens = Tokens.resolve();
        const kinds = new Array(60).fill("icon");
        const rest = Layout.computeRest(kinds, tokens, MONITOR, "bottom");
        assert.ok(rest.ratio < 1, "shrunk");
        assert.near(rest.length, MONITOR.width - 10, EPSILON, "fills available width");
        const placed = Layout.place(rest, null, null);
        checkIntegrity(assert, placed, MONITOR, "shrunk");
        assert.near(placed.dock.height, (48 + 2 * 14) * rest.ratio, EPSILON, "proportional height");
    },

    "magnification that does not fit is scaled down"(assert) {
        const tokens = Tokens.resolve();
        const kinds = new Array(60).fill("icon");
        const rest = Layout.computeRest(kinds, tokens, MONITOR, "bottom");
        const sizes = kinds.map(() => 200);
        const placed = Layout.place(rest, sizes, rest.centers[30]);
        checkIntegrity(assert, placed, MONITOR, "full width");
    },

    "scale factor doubles the geometry"(assert) {
        const big = { x: 0, y: 0, width: 3840, height: 2160 };
        const one = Layout.place(Layout.computeRest(KINDS, Tokens.resolve(), MONITOR, "bottom"), null, null);
        const two = Layout.place(Layout.computeRest(KINDS, Tokens.resolve({}, 2), big, "bottom"), null, null);
        assert.near(two.dock.width, one.dock.width * 2, EPSILON, "width");
        assert.near(two.dock.height, one.dock.height * 2, EPSILON, "height");
    },

    "invalid input is rejected"(assert) {
        const tokens = Tokens.resolve();
        assert.throws(() => Layout.computeRest(["icon"], tokens, MONITOR, "top"), "top edge");
        assert.throws(() => Layout.computeRest(["button"], tokens, MONITOR, "bottom"), "kind");
        assert.throws(() => Layout.computeRest(["icon"], tokens,
            { x: 0, y: 0, width: 10, height: 10 }, "bottom"), "no room");
    },

    "sections split pinned, running and trash"(assert) {
        const pinned = { pinned: true }, running = { pinned: false }, trash = { trash: true };
        const shape = entries => {
            const result = Layout.sections(entries);
            return result.kinds.map(kind => kind === "icon" ? "i" : "|").join("") + " " + result.roles.join(",");
        };
        assert.equal(shape([pinned, pinned, running, trash]), "ii|i|i running,trash");
        assert.equal(shape([pinned, pinned, trash]), "ii|i trash", "no running: only the trash line");
        assert.equal(shape([running, trash]), "i|i trash", "no pinned: no running line");
        assert.equal(shape([trash]), "i ", "trash alone");
        assert.equal(shape([pinned, running]), "i|i running", "no trash");
    },

    "thumbnails keep their aspect, centered and never enlarged"(assert) {
        const wide = Layout.fitThumbnail(1920, 1080, 200, 125);
        assert.equal(wide.width, 200);
        assert.equal(wide.height, 113);
        assert.equal(wide.x, 0);
        assert.equal(wide.y, 6);
        const tall = Layout.fitThumbnail(400, 800, 200, 125);
        assert.equal(tall.height, 125, "tall fits the height");
        assert.equal(tall.width, 63);
        const small = Layout.fitThumbnail(100, 50, 200, 125);
        assert.equal(small.width, 100, "small stays as is");
        assert.equal(small.x, 50);
    },

    "preview boxes shrink alike to fit the row"(assert) {
        const roomy = Layout.previewBox(3, 200, 125, 1800, 20, false);
        assert.equal(roomy.width, 200, "fits as is");
        const crowded = Layout.previewBox(10, 200, 125, 1800, 20, false);
        assert.equal(crowded.width, 160);
        assert.equal(crowded.height, 100);
        const column = Layout.previewBox(10, 200, 125, 1000, 20, true);
        assert.equal(column.height, 80, "vertical rows shrink by height");
    }
};
