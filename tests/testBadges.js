const Badges = imports.lib.badges;

var tests = {
    "app URIs map to normalized desktop ids"(assert) {
        assert.equal(Badges.desktopId("application://org.telegram.desktop.desktop"), "org.telegram.desktop");
        assert.equal(Badges.desktopId("application://Google-Chrome.desktop"), "google-chrome");
        assert.equal(Badges.desktopId("file:///tmp/x"), "");
        assert.equal(Badges.desktopId(null), "");
    },

    "updates merge count and visibility"(assert) {
        let state = Badges.merge(null, { count: 3 });
        assert.equal(Badges.label(state), null, "hidden until count-visible");
        state = Badges.merge(state, { "count-visible": true });
        assert.equal(Badges.label(state), "3");
        state = Badges.merge(state, { progress: 0.5 });
        assert.equal(Badges.label(state), "3", "other properties keep it");
        assert.equal(Badges.label(Badges.merge(state, { count: 0 })), null, "zero hides");
        assert.equal(Badges.label(Badges.merge(state, { "count-visible": false })), null);
    },

    "long counts are capped"(assert) {
        const shown = count => Badges.label(Badges.merge(null, { count: count, "count-visible": true }));
        assert.equal(shown(140), "140");
        assert.equal(shown(999), "999");
        assert.equal(shown(1000), "999+");
        assert.equal(shown(-2), null);
    }
};
