// SPEC §10 scenarios 1–4 and §5 requirement 7, with magnification and layout
// combined the way the dock view will combine them.
const Layout = imports.lib.layout;
const Magnification = imports.lib.magnification;
const Tokens = imports.lib.tokens;

const MONITOR = { x: 0, y: 0, width: 1920, height: 1080 };
const EPSILON = 1e-6;
const tokens = Tokens.resolve();

function frame(rest, pointer, amount) {
    const sizes = Magnification.sizes(rest.centers, pointer, rest.iconSize,
        Math.max(tokens["icon.maxSize"], rest.iconSize),
        tokens["magnification.sigma"] * rest.ratio, amount);
    return Layout.place(rest, sizes, pointer);
}

function iconsOf(placed) {
    return placed.items.filter(item => item.kind === "icon");
}

function centerX(rect) {
    return rect.x + rect.width / 2;
}

function under(placed, x) {
    return iconsOf(placed).findIndex(icon => x >= icon.rect.x && x < icon.rect.x + icon.rect.width);
}

function checkIntegrity(assert, placed, label) {
    let previousEnd = -Infinity;
    placed.items.forEach((item, index) => {
        assert.ok(item.rect.x >= previousEnd - EPSILON, label + ": overlap at " + index);
        assert.ok(item.rect.x >= -EPSILON && item.rect.x + item.rect.width <= MONITOR.width + EPSILON,
            label + ": item " + index + " off screen");
        previousEnd = item.rect.x + item.rect.width;
    });
    const bottoms = iconsOf(placed).map(icon => icon.rect.y + icon.rect.height);
    bottoms.forEach(bottom => assert.near(bottom, bottoms[0], EPSILON, label + ": base"));
}

const SEVEN = new Array(7).fill("icon");

var tests = {
    "1. rest: every icon at base size"(assert) {
        const placed = frame(Layout.computeRest(SEVEN, tokens, MONITOR, "bottom"), null);
        iconsOf(placed).forEach(icon => assert.equal(icon.size, 48));
    },

    "2. pointer on the central icon: max size, symmetric, stays under pointer"(assert) {
        const rest = Layout.computeRest(SEVEN, tokens, MONITOR, "bottom");
        const pointer = rest.centers[3];
        const placed = frame(rest, pointer);
        const icons = iconsOf(placed);
        assert.equal(icons[3].size, 72);
        assert.near(centerX(icons[3].rect), pointer, EPSILON, "hovered icon fixed");
        assert.near(centerX(placed.dock), MONITOR.width / 2, EPSILON, "dock grows evenly");
        for (let i = 0; i < 3; i++)
            assert.near(icons[i].size, icons[6 - i].size, EPSILON, "mirror " + i);
        checkIntegrity(assert, placed, "center");
    },

    "3. pointer between two icons: both neighbors grow equally"(assert) {
        const rest = Layout.computeRest(SEVEN, tokens, MONITOR, "bottom");
        const pointer = (rest.centers[2] + rest.centers[3]) / 2;
        const icons = iconsOf(frame(rest, pointer));
        assert.near(icons[2].size, icons[3].size, EPSILON, "pair");
        assert.ok(icons[2].size < 72 && icons[2].size > icons[1].size, "peak between them");
    },

    "4. pointer on the first and last icons"(assert) {
        const rest = Layout.computeRest(SEVEN, tokens, MONITOR, "bottom");
        [0, 6].forEach(index => {
            const pointer = rest.centers[index];
            const placed = frame(rest, pointer);
            assert.equal(iconsOf(placed)[index].size, 72);
            assert.equal(under(placed, pointer), index, "edge icon under pointer");
            checkIntegrity(assert, placed, "edge " + index);
        });
    },

    "pointer sweep: integrity, hovered icon under pointer, no jumps"(assert) {
        const rest = Layout.computeRest(SEVEN, tokens, MONITOR, "bottom");
        let previous = null;
        for (let pointer = rest.start; pointer <= rest.start + rest.length; pointer++) {
            const placed = frame(rest, pointer);
            checkIntegrity(assert, placed, "pointer " + pointer);
            const restIndex = rest.centers.findIndex(center =>
                pointer >= center - rest.iconSize / 2 && pointer < center + rest.iconSize / 2);
            if (restIndex >= 0)
                assert.equal(under(placed, pointer), restIndex, "under pointer " + pointer);
            if (previous) {
                placed.items.forEach((item, index) =>
                    assert.ok(Math.abs(item.rect.x - previous.items[index].rect.x) < 2,
                        "jump at pointer " + pointer + " item " + index));
            }
            previous = placed;
        }
    },

    "edge-clamped dock stays on screen"(assert) {
        const kinds = new Array(34).fill("icon");
        const rest = Layout.computeRest(kinds, tokens, MONITOR, "bottom");
        [rest.centers[0], rest.centers[33]].forEach(pointer =>
            checkIntegrity(assert, frame(rest, pointer), "crowded " + pointer));
    }
};
