const GLib = imports.gi.GLib;
const Animation = imports.lib.animation;
const Calibration = imports.lib.calibration;
const Tokens = imports.lib.tokens;

function schema() {
    const [, bytes] = GLib.file_get_contents("settings-schema.json");
    return JSON.parse(new TextDecoder().decode(bytes));
}

var tests = {
    "every key is in the schema, behind the calibration switch"(assert) {
        const keys = schema();
        assert.equal(keys["calibration"].type, "generic", "hidden switch");
        assert.equal(keys["calibration-section"].dependency, "calibration");
        Calibration.KEYS.forEach(key => assert.ok(key in keys, key));
    },

    "schema defaults are the values they override"(assert) {
        const keys = schema();
        const tuning = Calibration.tuning(Object.fromEntries(Calibration.KEYS.map(key => [key, keys[key].default])));
        Object.keys(tuning.tokens).forEach(token =>
            assert.equal(tuning.tokens[token], Tokens.DEFAULTS[token], token));
        Object.keys(tuning.timing).forEach(name =>
            assert.equal(tuning.timing[name], Animation.TIMING[name], name));
        // GLASS_SHADOW in lib/dockView.js.
        assert.ok(keys["cal-shadow-y"].max + keys["cal-shadow-blur"].max <= 40, "shadow within GLASS_SHADOW");
    },

    "tuning maps keys and converts percents"(assert) {
        const tuning = Calibration.tuning({ "cal-icon-gap": 10, "cal-bounce-height": 25, "cal-shadow-opacity": 30 });
        assert.equal(tuning.tokens["icon.gap"], 10);
        assert.equal(tuning.timing.bounceHeight, 0.25);
        assert.equal(tuning.shadow.opacity, 0.3);
        const off = Calibration.tuning({});
        assert.equal(Object.keys(off.tokens).length + Object.keys(off.timing).length, 0);
        assert.equal(off.shadow, null);
    }
};
