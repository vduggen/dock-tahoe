const State = imports.lib.state;
const { AppFlag, DockFlag } = State;

var tests = {
    "flags are distinct single bits"(assert) {
        [AppFlag, DockFlag].forEach(table => {
            const values = Object.values(table);
            values.forEach(value => assert.equal(value & (value - 1), 0, "single bit " + value));
            assert.equal(new Set(values).size, values.length, "distinct");
        });
    },

    "states combine independently"(assert) {
        let flags = 0;
        flags = State.set(flags, AppFlag.PINNED, true);
        flags = State.set(flags, AppFlag.RUNNING, true);
        flags = State.set(flags, AppFlag.MINIMIZED, true);
        flags = State.set(flags, AppFlag.BADGED, true);
        assert.equal(State.describe(flags, AppFlag), "PINNED|RUNNING|MINIMIZED|BADGED");
        assert.ok(!State.has(flags, AppFlag.FOCUSED), "running is not focused");

        flags = State.set(flags, AppFlag.MINIMIZED, false);
        assert.equal(State.describe(flags, AppFlag), "PINNED|RUNNING|BADGED");
    },

    "has requires every bit of a combined mask"(assert) {
        const flags = AppFlag.PINNED;
        assert.ok(!State.has(flags, AppFlag.PINNED | AppFlag.RUNNING), "partial mask");
        assert.equal(State.describe(0, DockFlag), "NONE");
    }
};
