const Tokens = imports.lib.tokens;

var tests = {
    "defaults resolve unchanged at scale 1"(assert) {
        const tokens = Tokens.resolve();
        assert.equal(tokens["icon.baseSize"], 48);
        assert.equal(tokens["glass.blurRadius"], 20);
    },

    "scale factor multiplies every token"(assert) {
        const tokens = Tokens.resolve({}, 2);
        Object.keys(Tokens.DEFAULTS).forEach(key =>
            assert.equal(tokens[key], Tokens.DEFAULTS[key] * 2, key));
    },

    "overrides replace defaults without mutating them"(assert) {
        const tokens = Tokens.resolve({ "icon.gap": 9 });
        assert.equal(tokens["icon.gap"], 9);
        assert.equal(Tokens.DEFAULTS["icon.gap"], 7);
    },

    "invalid input is rejected"(assert) {
        assert.throws(() => Tokens.resolve({ "icon.gapp": 1 }), "unknown key");
        assert.throws(() => Tokens.resolve({ "icon.gap": -1 }), "negative");
        assert.throws(() => Tokens.resolve({ "icon.gap": NaN }), "NaN");
        assert.throws(() => Tokens.resolve({ "icon.maxSize": 40 }), "max < base");
        assert.throws(() => Tokens.resolve({}, 0), "zero scale");
    }
};
