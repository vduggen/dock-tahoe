const Animation = imports.lib.animation;

var tests = {
    "approach is frame-rate independent"(assert) {
        let fast = 0;
        for (let i = 0; i < 12; i++)
            fast = Animation.approach(fast, 1, 1000 / 60, 200);
        let slow = 0;
        for (let i = 0; i < 6; i++)
            slow = Animation.approach(slow, 1, 1000 / 30, 200);
        assert.near(fast, slow, 1e-9, "60 Hz = 30 Hz after 200 ms");
        assert.near(fast, 1 - Math.exp(-3), 1e-9, "~95% after the duration");
    },

    "approach can be redirected and jumps without a duration"(assert) {
        const halfway = Animation.approach(0, 1, 50, 200);
        const back = Animation.approach(halfway, 0, 16, 200);
        assert.ok(back < halfway && back > 0, "turns around smoothly");
        assert.equal(Animation.approach(0.3, 1, 16, 0), 1, "reduced motion");
        assert.equal(Animation.approach(null, 5, 16, 200), 5, "no previous value");
    },

    "bounce rises and lands for each bounce"(assert) {
        assert.equal(Animation.bounce(0, 600, 3), 0);
        assert.equal(Animation.bounce(300, 600, 3), 1);
        assert.near(Animation.bounce(900, 600, 3), 1, 1e-9, "second peak");
        assert.equal(Animation.bounce(1800, 600, 3), 0, "done");
        assert.equal(Animation.bounce(-1, 600, 3), 0);
        for (let t = 0; t < 1800; t += 10) {
            const height = Animation.bounce(t, 600, 3);
            assert.ok(height >= 0 && height <= 1, "range at " + t);
        }
    },

    "easing is clamped and monotonic"(assert) {
        assert.equal(Animation.easeOutCubic(-1), 0);
        assert.equal(Animation.easeOutCubic(2), 1);
        let previous = 0;
        for (let t = 0; t <= 1; t += 0.05) {
            const value = Animation.easeOutCubic(t);
            assert.ok(value >= previous, "monotonic at " + t);
            previous = value;
        }
    }
};
