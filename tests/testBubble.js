const Bubble = imports.lib.bubble;

const METRICS = { radius: 12, arrowWidth: 22, arrowHeight: 10 };

function tipOf(segments) {
    const curve = segments.find(segment => segment[0] === "curve");
    return { x: curve[5], y: curve[6] };
}

var tests = {
    "the tip points at the requested spot on the arrow edge"(assert) {
        const tip = tipOf(Bubble.outline(200, 60, 80, METRICS));
        assert.equal(tip.x, 80);
        assert.equal(tip.y, 60, "tip on the far edge");
    },

    "the tip stays off the rounded corners"(assert) {
        assert.equal(tipOf(Bubble.outline(200, 60, 0, METRICS)).x, 12 + 11);
        assert.equal(tipOf(Bubble.outline(200, 60, 500, METRICS)).x, 200 - 12 - 11);
        assert.equal(Bubble.clampTip(5, 20, 12, 22), 10, "too short: centered");
    },

    "the body leaves room for the arrow and the radius fits"(assert) {
        const segments = Bubble.outline(100, 30, 50, METRICS);
        const arc = segments.find(segment => segment[0] === "arc");
        assert.equal(arc[3], 10, "radius limited to half the body (20 / 2)");
        assert.equal(segments[segments.length - 1][0], "close");
    },

    "sides map onto the canonical frame"(assert) {
        assert.equal(Bubble.frame(120, 40, "bottom").length, 120);
        assert.equal(Bubble.frame(120, 40, "left").length, 40);
        assert.equal(Bubble.canonicalTip(10, 120, 40, "right"), 30);
        assert.equal(Bubble.canonicalTip(10, 120, 40, "left"), 10);
        // Canonical bottom edge (y = depth) lands on the actor's arrow side.
        const left = Bubble.transform(120, 40, "left");
        const x = left.x + Math.cos(left.angle) * 0 - Math.sin(left.angle) * 120;
        assert.near(x, 0, 1e-9, "left: depth maps to x = 0");
        const right = Bubble.transform(120, 40, "right");
        assert.near(right.x - Math.sin(right.angle) * 120, 120, 1e-9, "right: depth maps to x = width");
    }
};
