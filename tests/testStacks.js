const Stacks = imports.lib.stacks;

var tests = {
    "saved options, else Downloads newest first"(assert) {
        const downloads = Stacks.options(null, true);
        assert.equal(downloads.view, "auto");
        assert.equal(downloads.sort, "modified");
        assert.equal(Stacks.options(undefined, false).sort, "name");
        const saved = Stacks.options({ view: "list", sort: "kind" }, true);
        assert.equal(saved.view + "," + saved.sort, "list,kind");
        const bad = Stacks.options({ view: "cover", sort: "size" }, false);
        assert.equal(bad.view + "," + bad.sort, "auto,name", "unknown values reset");
    },

    "sorts by name, date or kind"(assert) {
        const items = [
            { name: "foto 10.png", directory: false, kind: "image/png", modified: 30, created: 1 },
            { name: "Foto 2.png", directory: false, kind: "image/png", modified: 10, created: 3 },
            { name: "notas.txt", directory: false, kind: "text/plain", modified: 20, created: 2 },
            { name: "Projetos", directory: true, kind: "inode/directory", modified: 5, created: 4 }
        ];
        const names = sort => Stacks.sortItems(items, sort).map(item => item.name).join("|");
        assert.equal(names("name"), "Foto 2.png|foto 10.png|notas.txt|Projetos", "natural, any case");
        assert.equal(names("modified"), "foto 10.png|notas.txt|Foto 2.png|Projetos", "newest first");
        assert.equal(names("created"), "Projetos|Foto 2.png|notas.txt|foto 10.png");
        assert.equal(names("kind"), "Projetos|Foto 2.png|foto 10.png|notas.txt", "folders first");
        assert.equal(items[0].name, "foto 10.png", "input untouched");
    },

    "auto opens the fan while it fits, at the bottom only"(assert) {
        assert.equal(Stacks.resolveView("auto", Stacks.FAN_MAX, "bottom"), "fan");
        assert.equal(Stacks.resolveView("auto", Stacks.FAN_MAX + 1, "bottom"), "grid");
        assert.equal(Stacks.resolveView("fan", 40, "bottom"), "fan", "fan by choice keeps the first ones");
        assert.equal(Stacks.resolveView("fan", 3, "left"), "grid");
        assert.equal(Stacks.resolveView("auto", 3, "right"), "grid");
        assert.equal(Stacks.resolveView("list", 3, "bottom"), "list");
    },

    "fan rises from the icon and bends away"(assert) {
        const slots = Stacks.fanSlots(40, 50);
        assert.equal(slots.length, Stacks.FAN_MAX, "capped");
        assert.equal(slots[0].y, -25, "first one right above the icon");
        assert.equal(slots[0].x, 0);
        assert.equal(slots[0].angle, 0);
        assert.equal(slots[1].y - slots[0].y, -50, "a step apart");
        const last = slots[slots.length - 1];
        assert.near(last.x, Stacks.FAN_BEND * Stacks.FAN_MAX * 50, 1e-9);
        assert.equal(last.angle, Stacks.FAN_TILT);
        assert.ok(slots[5].x < last.x / 2, "bends more as it rises");
        assert.equal(Stacks.fanSlots(0, 50).length, 0);
    },

    "grid as square as it gets, capped in width"(assert) {
        const shape = count => { const s = Stacks.gridShape(count); return s.columns + "x" + s.rows; };
        assert.equal(shape(0), "1x0");
        assert.equal(shape(1), "1x1");
        assert.equal(shape(5), "3x2");
        assert.equal(shape(16), "4x4");
        assert.equal(shape(100), "7x15");
    }
};
