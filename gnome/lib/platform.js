// Platform layer, GNOME Shell side: the same names as lib/platform.js, for
// GNOME Shell 46. The build (scripts/build-gnome.js) puts this file in
// place of the Cinnamon one.

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Mtk from "gi://Mtk";
import Shell from "gi://Shell";
import St from "gi://St";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

export const NAME = "gnome";

// Mutter has no per-window monitor, workspace or skip-taskbar signals on
// the display; the windows notify those themselves.
export const DISPLAY_SIGNALS = [
    "notify::focus-window",
    "window-demands-attention",
    "window-marked-urgent",
    "window-entered-monitor",
    "window-left-monitor"
];
export const WINDOW_SIGNALS = ["workspace-changed", "notify::skip-taskbar", "notify::on-all-workspaces"];
export const TRACKER_SIGNALS = ["tracked-windows-changed"];

export const DirectionType = St.DirectionType;

// The GSettings key of the focus shortcut (gnome/lib/settings.js).
const HOTKEY_KEY = "focus-hotkey";
const MENU_SIDES = { bottom: St.Side.BOTTOM, left: St.Side.LEFT, right: St.Side.RIGHT };
// What a bubble backdrop copies from the actor it paints (paintSurface).
const MIRRORED = ["opacity", "visible", "scale-x", "scale-y", "translation-x", "translation-y"];

export function appSystem() {
    return Shell.AppSystem.get_default();
}

export function windowTracker() {
    return Shell.WindowTracker.get_default();
}

export function animationsEnabled() {
    return St.Settings.get().enable_animations;
}

// Actors pushModal() made reactive: a press on one of them, and on none of
// its own reactive children, landed on nothing of it.
const madeReactive = new Set();

// A handle for popModal(), or null when the keyboard could not be grabbed.
// onEvent(event) sees every event while the grab lasts, before the actor
// under the pointer does.
//
// A Clutter grab sends every event to the grabbed actor, clicks elsewhere
// included, and the stage outside it sees none; Clutter also skips actors
// that are not reactive. So the actor is made reactive for the grab, or
// Escape and clicks elsewhere would never reach it and the grab would keep
// the whole desktop.
export function pushModal(actor, onEvent) {
    const reactive = actor.reactive;
    actor.reactive = true;
    const grab = Main.pushModal(actor);
    if (!(grab.get_seat_state() & Clutter.GrabState.KEYBOARD)) {
        Main.popModal(grab);
        actor.reactive = reactive;
        return null;
    }
    if (!reactive)
        madeReactive.add(actor);
    const eventId = actor.connect("captured-event", (source, event) => onEvent(event));
    return { actor: actor, grab: grab, eventId: eventId, reactive: reactive };
}

export function popModal(handle) {
    handle.actor.disconnect(handle.eventId);
    madeReactive.delete(handle.actor);
    handle.actor.reactive = handle.reactive;
    Main.popModal(handle.grab);
}

// The reactive actor an event happened on, or null. Under a grab the stage
// reports the grabbed actor for presses outside it, so button events are
// picked at their position instead.
export function eventActor(event) {
    const type = event.type();
    if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE)
        return global.stage.get_event_actor(event);
    const [x, y] = event.get_coords();
    const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
    return madeReactive.has(picked) ? null : picked;
}

export function launchContext() {
    return global.create_app_launch_context(0, -1);
}

export function rectangle(rect) {
    return new Mtk.Rectangle(rect);
}

export function log(message) {
    console.log(message);
}

export function logError(error, message) {
    console.error(message + ":", error);
}

// Mutter's timelines follow an actor's frame clock.
export function timeline(actor, params) {
    return new Clutter.Timeline(Object.assign({ actor: actor }, params));
}

// The desktop backgrounds, one per monitor at its place on the stage, as a
// clone source (lib/glassBlur.js).
export function backgroundActor() {
    return Main.layoutManager._backgroundGroup;
}

// Main.layoutManager.addChrome() parameters, as Cinnamon names them:
// hiding in fullscreen is trackFullscreen here.
export function chrome(params) {
    const result = Object.assign({}, params);
    if ("visibleInFullscreen" in result) {
        result.trackFullscreen = !result.visibleInFullscreen;
        delete result.visibleInFullscreen;
    }
    return result;
}

export function setScrollChild(scroll, child) {
    scroll.set_child(child);
}

// Paints draw(cr, width, height) under `actor` at its size. Mutter has no
// Clutter.Canvas to set as content, so a drawing area sits just below the
// actor, bound to its geometry, and copies its opacity, visibility, scale
// and translation. Returns { invalidate() } for a repaint.
export function paintSurface(actor, draw) {
    const area = new St.DrawingArea({ reactive: false });
    area.connect("repaint", () => {
        const [width, height] = area.get_surface_size();
        draw(area.get_context(), width, height);
    });
    area.add_constraint(new Clutter.BindConstraint({ source: actor, coordinate: Clutter.BindCoordinate.ALL }));
    MIRRORED.forEach(property => actor.bind_property(property, area, property, GObject.BindingFlags.SYNC_CREATE));
    const place = () => {
        const parent = actor.get_parent();
        const current = area.get_parent();
        if (current && current !== parent)
            current.remove_child(area);
        if (!parent)
            return;
        if (!current || current !== parent)
            parent.insert_child_below(area, actor);
        else
            parent.set_child_below_sibling(area, actor);
    };
    actor.connect("parent-set", place);
    actor.connect("destroy", () => area.destroy());
    place();
    return { invalidate: () => area.queue_repaint() };
}

// BoxPointer places the menu against its source; a dock menu belongs beyond
// the pill instead. place(x, y, width, height) returns the adjusted stage
// position. The box pointer's own drawing is turned off in the stylesheet:
// the bubble (lib/bubbleActor.js) draws the menu.
class DockMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, side, place) {
        super(sourceActor, 0.5, side);
        const boxPointer = this._boxPointer;
        const reposition = boxPointer._reposition.bind(boxPointer);
        boxPointer._reposition = box => {
            reposition(box);
            const [x, y] = box.get_origin();
            const [, , width, height] = boxPointer.get_preferred_size();
            const [placedX, placedY] = place(x, y, width, height);
            box.set_origin(placedX, placedY);
        };
    }
}

// A context menu for `sourceActor` on a dock at `position`, styled
// .tahoe-menu, placed by place(x, y, width, height).
export function createMenu(sourceActor, position, place) {
    const menu = new DockMenu(sourceActor, MENU_SIDES[position], place);
    menu.actor.add_style_class_name("tahoe-menu");
    return menu;
}

export function openMenu(menu) {
    menu.open(BoxPointer.PopupAnimation.FADE);
}

// Marks a menu item as the chosen one of its group; the others keep the
// dot's room, so the labels line up.
export function setDot(item, on) {
    item.setOrnament(on ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
}

// settings: gnome/lib/settings.js DockSettings. The shortcut follows its
// GSettings key by itself.
export function bindHotkey(settings, callback) {
    Main.wm.addKeybinding(HOTKEY_KEY, settings.gsettings, Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, callback);
}

export function unbindHotkey() {
    Main.wm.removeKeybinding(HOTKEY_KEY);
}

// GNOME Shell's top bar is never on the dock's edge.
export function watchPanels(connect, callback) {
}

export function panelInset(monitorIndex, position) {
    return 0;
}
