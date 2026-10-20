const Magnification = imports.lib.magnification;

const CENTERS = [100, 160, 220, 280, 340];
const BASE = 48;
const MAX = 72;
const SIGMA = 60;

function run(pointer, amount) {
    return Magnification.sizes(CENTERS, pointer, BASE, MAX, SIGMA, amount);
}

var tests = {
    "no pointer keeps every icon at base size"(assert) {
        run(null).forEach(size => assert.equal(size, BASE));
    },

    "icon under the pointer reaches max size"(assert) {
        assert.equal(run(220)[2], MAX);
    },

    "influence falls off symmetrically with distance"(assert) {
        const result = run(220);
        assert.near(result[1], result[3], 1e-9, "neighbors");
        assert.near(result[0], result[4], 1e-9, "outer");
        assert.ok(result[2] > result[1] && result[1] > result[0], "monotonic");
        assert.ok(result[0] > BASE, "outer icons still feel the pointer");
    },

    "sizes stay within base and max"(assert) {
        for (let pointer = 0; pointer <= 450; pointer += 7)
            run(pointer).forEach(size =>
                assert.ok(size >= BASE && size <= MAX, "pointer " + pointer));
    },

    "small pointer moves give small size changes"(assert) {
        // Max slope of the Gaussian is extra / (sigma * sqrt(e)).
        const bound = (MAX - BASE) / (SIGMA * Math.sqrt(Math.E)) + 1e-9;
        for (let pointer = 50; pointer < 400; pointer++) {
            const a = run(pointer);
            const b = run(pointer + 1);
            a.forEach((size, i) =>
                assert.ok(Math.abs(b[i] - size) <= bound, "pointer " + pointer));
        }
    },

    "amount scales the magnification for enter and leave"(assert) {
        assert.equal(run(220, 0)[2], BASE);
        assert.equal(run(220, 0.5)[2], BASE + (MAX - BASE) / 2);
        assert.equal(run(220, 2)[2], MAX, "clamped to 1");
    },

    "separators are skipped"(assert) {
        const result = Magnification.sizes([100, null, 160], 100, BASE, MAX, SIGMA);
        assert.equal(result[1], null);
        assert.equal(result[0], MAX);
    }
};
