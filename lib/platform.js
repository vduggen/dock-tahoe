// Platform layer, Cinnamon side: everything Cinnamon and GNOME Shell do
// differently, behind one set of names. gnome/lib/platform.js exports the
// same names for GNOME Shell; the rest of lib/ only goes through these.

const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const { PanelLoc } = imports.ui.panel;

var NAME = "cinnamon";

// Signals that change what the dock shows (lib/appTracker.js), on top of
// the window properties both platforms notify.
var DISPLAY_SIGNALS = [
    "notify::focus-window",
    "window-demands-attention",
    "window-marked-urgent",
    "window-monitor-changed",
    "window-workspace-changed",
    "window-skip-taskbar-changed"
];
var WINDOW_SIGNALS = [];
var TRACKER_SIGNALS = ["window-app-changed"];

// St.Widget.navigate_focus() directions.
var DirectionType = Gtk.DirectionType;

const HOTKEY_NAME = "tahoe-dock-focus";
const PANEL_KEYS = ["panels-enabled", "panels-height", "panels-autohide"];
const MENU_SIDES = { bottom: St.Side.BOTTOM, left: St.Side.LEFT, right: St.Side.RIGHT };

function appSystem() {
    return Cinnamon.AppSystem.get_default();
}

function windowTracker() {
    return Cinnamon.WindowTracker.get_default();
}

function animationsEnabled() {
    return Main.animations_enabled;
}

// A handle for popModal(), or null when the grab failed. onEvent(event)
// sees every event while the grab lasts, before the actor under the pointer
// does, as the stage's captured-event.
function pushModal(actor, onEvent) {
    if (!Main.pushModal(actor))
        return null;
    return { actor: actor, eventId: global.stage.connect("captured-event", (stage, event) => onEvent(event)) };
}

function popModal(handle) {
    global.stage.disconnect(handle.eventId);
    Main.popModal(handle.actor);
}

// The reactive actor an event happened on.
function eventActor(event) {
    return event.get_source();
}

function launchContext() {
    return global.create_app_launch_context();
}

function rectangle(rect) {
    return new Meta.Rectangle(rect);
}

function log(message) {
    global.log(message);
}

function logError(error, message) {
    global.logError(error, message);
}

// A timeline driving `actor`'s animation.
function timeline(actor, params) {
    return new Clutter.Timeline(params);
}

// The desktop background, as a clone source (lib/glassBlur.js).
function backgroundActor() {
    return global.background_actor;
}

// Main.layoutManager.addChrome() parameters, as Cinnamon names them.
function chrome(params) {
    return params;
}

function setScrollChild(scroll, child) {
    scroll.add_actor(child);
}

// Paints draw(cr, width, height) as `actor`'s content, under its children,
// at its allocated size. Returns { invalidate() } for a repaint.
function paintSurface(actor, draw) {
    const canvas = new Clutter.Canvas();
    canvas.connect("draw", (c, cr, width, height) => draw(cr, width, height));
    actor.set_content(canvas);
    actor.connect("notify::allocation", () => {
        const box = actor.get_allocation_box();
        canvas.set_size(Math.max(1, Math.round(box.get_width())),
            Math.max(1, Math.round(box.get_height())));
    });
    return canvas;
}

// PopupMenu places BOTTOM menus at the screen edge, as for a panel; a dock
// menu belongs beyond the pill instead. place(x, y, width, height) returns
// the adjusted stage position.
class DockMenu extends PopupMenu.PopupMenu {
    _init(sourceActor, orientation, place) {
        super._init(sourceActor, orientation);
        this._place = place;
    }

    _calculatePosition() {
        const [x, y] = super._calculatePosition();
        const [, , width, height] = this.actor.get_preferred_size();
        return this._place(x, y, width, height);
    }
}

// A context menu for `sourceActor` on a dock at `position`, styled
// .tahoe-menu, placed by place(x, y, width, height).
function createMenu(sourceActor, position, place) {
    const menu = new DockMenu(sourceActor, MENU_SIDES[position], place);
    menu.setCustomStyleClass("tahoe-menu");
    return menu;
}

function openMenu(menu) {
    menu.open(true);
}

// Marks a menu item as the chosen one of its group.
function setDot(item, on) {
    item.setOrnament(PopupMenu.OrnamentType.DOT, on);
}

// settings: lib/settings.js DockSettings.
function bindHotkey(settings, callback) {
    Main.keybindingManager.addHotKey(HOTKEY_NAME, settings.focusHotkey, callback);
}

function unbindHotkey() {
    Main.keybindingManager.removeHotKey(HOTKEY_NAME);
}

// GNOME Shell only: Cinnamon's overviews place nothing under the dock.
function reserveOverview(monitorIndex, position, thickness, scaleFactor) {
}

// Calls callback() when panels may have changed size. connect(object,
// signal, callback) keeps the connection for the caller to undo.
function watchPanels(connect, callback) {
    PANEL_KEYS.forEach(key => connect(global.settings, "changed::" + key, callback));
}

// Thickness of the always-visible Cinnamon panels on the dock's edge, so
// the dock floats above them instead of covering them.
function panelInset(monitorIndex, position) {
    if (!Main.panelManager)
        return 0;
    const location = PanelLoc[position];
    return Main.panelManager.getPanelsInMonitor(monitorIndex)
        .filter(panel => panel.panelPosition === location && !panel.isHideable())
        .reduce((sum, panel) => sum + (position === "bottom"
            ? panel.actor.get_height()
            : panel.actor.get_width()), 0);
}
