// Exercise the actual view methods with actors mocked, without a desktop.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const empty = new Proxy({}, { get: () => ({}) });
const context = vm.createContext({ imports: { gi: empty, ui: empty }, require: () => ({}) });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../lib/dockView.js"), "utf8") +
    "\nthis.View = DockView;", context);

let starts = 0;
let stops = 0;
let closed = 0;
const actor = () => ({ visible: true, hide() { this.visible = false; }, show() { this.visible = true; } });
const view = Object.create(context.View.prototype);
Object.assign(view, {
    actor: actor(), trigger: actor(), hitArea: actor(), content: {},
    _timeline: { stop() { stops++; }, start() { starts++; }, is_playing: () => false },
    endKeyboard() { closed++; }, _destroyMenu() { closed++; },
    hidePreview() { closed++; }, setTooltip() { closed++; },
    _stack: { close() { closed++; } },
    rest: { crossLength: 50 }, tokens: { "dock.bottomOffset": 10 },
    _reveal: 1, edgeInset: 0, position: "bottom", autohide: true
});
view.setOverviewHidden(true);
assert.equal(view.actor.visible, false, "monitor-sized actor must not intercept Expo DND");
assert.equal(view.trigger.visible, false);
assert.equal(closed, 5, "release modal UI before hiding");
assert.equal(stops, 1);
view._wake();
view._applyReveal();
assert.equal(starts, 0, "events must not wake a suppressed dock");
assert.equal(view.trigger.visible, false, "auto-hide must not restore the edge trigger in Expo");
view.setOverviewHidden(false);
assert.equal(view.actor.visible, true);
assert.equal(view.trigger.visible, true);
assert.equal(starts, 1);
console.log("Dock overview: hide, modal cleanup and restoration passed");
