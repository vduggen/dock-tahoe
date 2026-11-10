// Exercise real hover/reveal transitions without a running desktop.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const animation = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/animation.js"), "utf8"), animation);
const empty = new Proxy({}, { get: () => ({}) });
let pointer = [0, 0];
let enabled = true;
const context = vm.createContext({
    imports: { gi: empty, ui: empty },
    global: { get_pointer: () => pointer },
    require: name => name === "./lib/animation.js" ? animation
        : name === "./lib/platform.js" ? { animationsEnabled: () => enabled } : {}
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../lib/dockView.js"), "utf8") +
    "\nthis.View = DockView;", context);

for (const position of ["bottom", "left", "right"]) {
    for (const animations of [true, false]) {
        enabled = animations;
        let now = 1000;
        const dock = position === "bottom" ? { x: 100, y: 340, width: 200, height: 50 }
            : { x: position === "left" ? 10 : 340, y: 100, width: 50, height: 200 };
        const view = Object.create(context.View.prototype);
        Object.assign(view, {
            position, autohide: true, scaleFactor: 1, edgeInset: 0,
            monitor: { x: 0, y: 0, width: 400, height: 400 },
            rest: { start: 100, length: 200, crossLength: 50 },
            tokens: { "dock.bottomOffset": 10 }, timing: animation.TIMING,
            _placed: { dock }, _reveal: 1, _wanted: true, _wantedAt: now,
            _hovering: true, _amount: 0, _pointer: null, _keyboard: false,
            _preview: { actor: { hover: false } }, _leaving: [],
            content: { translation_x: 0, translation_y: 0 }, hitArea: {}, trigger: {},
            _timeline: { stop() {} }, now: () => now,
            _stepBounces: () => false, _menuOpen: () => false,
            _setRect() {}, _zone: () => dock, _relayout() {}
        });
        const tick = (point, elapsed = 16) => {
            pointer = point;
            now += elapsed;
            view._tick(elapsed);
        };
        const center = rect => [rect.x + rect.width / 2, rect.y + rect.height / 2];
        const visibleCenter = () => {
            const x = dock.x + view.content.translation_x;
            const y = dock.y + view.content.translation_y;
            return [(Math.max(0, x) + Math.min(400, x + dock.width)) / 2,
                (Math.max(0, y) + Math.min(400, y + dock.height)) / 2];
        };
        const outside = [200, 50];
        const label = position + ", animations=" + animations;

        tick(outside);
        assert.equal(view._reveal, 1, "keep the hide delay: " + label);
        tick(center(dock));
        assert.equal(view._wanted, true, "allow reentry before hiding: " + label);
        tick(outside);
        if (animations) {
            now += 300;
            tick(outside);
            assert.ok(view._reveal > 0 && view._reveal < 1, "partially hidden: " + label);
            tick(visibleCenter());
            assert.equal(view._wanted, true, "visible dock remains accessible while hiding: " + label);
            tick(outside);
        }
        tick(outside, 301);
        assert.ok(view._reveal < 1, "start hiding: " + label);
        tick(center(dock));
        assert.equal(view._hovering, false, "old dock area must not hover: " + label);
        assert.equal(view._wanted, false, "old dock area must not reopen: " + label);
        assert.equal(view.hitArea.visible, false, "release the window underneath: " + label);

        tick(center(view._triggerRect()));
        assert.equal(view._wanted, true, "edge must reopen even during hiding: " + label);
        // Leave the trigger through the gap before reaching the moving dock.
        // A single unwanted frame must not lock out hover during the reveal.
        tick(outside);
        assert.equal(view._wanted, false, "cross the gap during reveal: " + label);
        tick(visibleCenter());
        assert.equal(view._hovering, true, "allow entering the revealed dock: " + label);
        assert.equal(view._wanted, true, "moving dock must not flee the pointer: " + label);

        tick(outside);
        tick(outside, 1000);
        assert.equal(view._reveal, 0, "finish hiding: " + label);
        tick(center(dock));
        assert.equal(view._wanted, false, "hidden dock opens only at the edge: " + label);
        view._keyboard = true;
        tick(outside);
        assert.equal(view._wanted, true, "keyboard must still reveal: " + label);
    }
}
console.log("Dock auto-hide: reentry, edge reveal and keyboard passed for all positions and motion settings");
