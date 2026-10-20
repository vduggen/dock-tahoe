// Dock view for one monitor: St actors placed from lib/layout.js geometry.
//
// Actors:
//   reservation  invisible strip along the whole monitor edge; publishes the
//                strut so maximized windows stop before the dock.
//   actor        monitor-sized, non-reactive container for every visible
//                piece; children use monitor-relative coordinates.
//   hitArea      invisible child that alone joins the stage input region, so
//                clicks elsewhere along the edge still reach the windows.
//
// Items are kept by key: an update only creates or destroys the items that
// appeared or disappeared, and repositions the rest.
//
// Motion: one timeline per view runs only while something moves. Each frame
// reads the pointer, eases the magnification amount and pointer
// (lib/animation.js) and re-applies the layout; it stops once everything has
// settled, and pointer events on the dock start it again.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Animation = require("./lib/animation.js");
const Layout = require("./lib/layout.js");
const Magnification = require("./lib/magnification.js");
const Tokens = require("./lib/tokens.js");

const ICON_FALLBACK = "application-x-executable";
// Starting points (SPEC §6 "Tooltip: medir no Tahoe").
const TOOLTIP_GAP = 10;
const TOOLTIP_FADE_MS = 120;
// Side of the menu that faces its icon.
const MENU_SIDES = { bottom: St.Side.BOTTOM, left: St.Side.LEFT, right: St.Side.RIGHT };
const MENU_GAP = 8;

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

class DockItem {
    constructor(view, entry) {
        this.key = entry.key;
        this.entry = entry;

        // Icons are rendered once at max size and scaled down, so
        // magnification (stage 4) never re-rasterizes them.
        this.button = new St.Button({
            style_class: "tahoe-item",
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE
        });
        this.button.set_size(view.maxIconSize, view.maxIconSize);
        this.button.set_child(this._createIcon(entry, view.maxIconSize / view.scaleFactor));
        this.button.accessible_name = entry.name;
        this.button.connect("clicked", (button, clickedButton) => {
            view.endKeyboard();
            if (clickedButton === 3)
                view.openMenu(this);
            else
                view.launchOrActivate(this);
        });
        // St.Widget turns the Menu key and Shift+F10 into "popup-menu".
        this.button.connect("popup-menu", () => {
            view.endKeyboard();
            view.openMenu(this);
            view.focusMenu();
        });
        this.button.connect("notify::hover", () => view.setTooltip(this, this.button.hover));
        this.button.connect("key-focus-in", () => view.setTooltip(this, true));
        this.button.connect("key-focus-out", () => view.setTooltip(this, false));

        this.indicator = new St.Widget({ style_class: "tahoe-indicator", visible: false });
        // SPEC §4: focus has its own cue; the running dot alone is not focus.
        this.highlight = new St.Widget({ style_class: "tahoe-highlight", visible: false });

        view.actor.add_child(this.highlight);
        view.actor.add_child(this.indicator);
        view.actor.add_child(this.button);
    }

    _createIcon(entry, logicalSize) {
        const gicon = entry.info ? entry.info.get_icon() : null;
        if (gicon)
            return new St.Icon({ gicon: gicon, icon_size: logicalSize, style_class: "tahoe-icon" });
        if (entry.app)
            return entry.app.create_icon_texture(logicalSize);
        return new St.Icon({ icon_name: ICON_FALLBACK, icon_size: logicalSize, style_class: "tahoe-icon" });
    }

    update(entry, view) {
        const wasAttention = Boolean(this.entry.facts && this.entry.facts.attention);
        this.entry = entry;
        this.button.accessible_name = entry.name;
        this.indicator.visible = entry.facts.hasWindows;
        this.highlight.visible = entry.facts.focused;
        // A launch bounces until its first window, finishing the bounce in the air.
        if (this.bounce && this.bounce.launch && entry.windows.length)
            this.bounce.count = Math.max(1, Math.ceil((view.now() - this.bounce.start) / Animation.TIMING.bounceMs));
        if (entry.facts.attention && !wasAttention)
            view.startBounce(this, Animation.TIMING.attentionBounces, false);
    }

    destroy() {
        this.button.destroy();
        this.indicator.destroy();
        this.highlight.destroy();
    }
}

class DockView {
    // actions: { activate(entry, monitorIndex) }, implemented by the controller.
    constructor(monitor, position, scaleFactor, edgeInset, actions) {
        this.monitor = monitor;
        this.actions = actions;
        this.position = position;
        this.edgeInset = edgeInset;
        this.scaleFactor = scaleFactor;
        this.tokens = Tokens.resolve({}, scaleFactor);
        this.maxIconSize = this.tokens["icon.maxSize"];
        this._items = new Map();
        this._order = [];
        this.rest = null;
        this._placed = null;
        // Reorder transition (SPEC §6): where things were when the dock's
        // contents last changed, and items fading out after removal.
        this._signature = "";
        this._blend = null;
        this._leaving = [];
        // Magnification: eased 0..1 amount and main-axis pointer.
        this._hovering = false;
        this._amount = 0;
        this._pointer = null;
        this._timeline = new Clutter.Timeline({ duration: 1000, repeat_count: -1 });
        this._timelineId = this._timeline.connect("new-frame", () => this._tick(this._timeline.get_delta()));

        this.actor = new St.Widget({ name: "tahoe-dock-container", reactive: false });
        // Cinnamon convention; also lets Looking Glass reach the view.
        this.actor._delegate = this;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        this.pill = new St.Widget({ style_class: "tahoe-dock" });
        // Reactive so the gaps between icons also count as the dock; its
        // events bubble to this.actor with the buttons'.
        this.hitArea = new St.Widget({ reactive: true });
        // Between pinned apps and running apps that are not pinned.
        this.separator = new St.Widget({ style_class: "tahoe-separator", visible: false });
        this.tooltip = new St.Label({ style_class: "tahoe-tooltip", visible: false });
        this._tooltipOwner = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = null;
        this._menuOwner = null;
        this._keyboard = false;
        this._stageEventId = 0;
        this.actor.connect("key-press-event", (actor, event) => this._onKeyPress(event));
        ["enter-event", "leave-event", "motion-event"].forEach(signal =>
            this.actor.connect(signal, () => {
                this._wake();
                return Clutter.EVENT_PROPAGATE;
            }));
        this.actor.add_child(this.pill);
        this.actor.add_child(this.separator);
        this.actor.add_child(this.hitArea);
        this.actor.add_child(this.tooltip);

        this.reservation = new St.Widget({ name: "tahoe-dock-reservation", reactive: false });

        Main.layoutManager.addChrome(this.reservation, {
            affectsStruts: true,
            affectsInputRegion: false,
            visibleInFullscreen: false
        });
        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            affectsInputRegion: false,
            visibleInFullscreen: false
        });
        Main.layoutManager.trackChrome(this.hitArea, { affectsInputRegion: true });
    }

    // entries: [{ key, name, app, info, facts }] in dock order.
    update(entries) {
        const keys = new Set(entries.map(entry => entry.key));
        const animate = Boolean(this._placed) && Main.animations_enabled;
        this._items.forEach((item, key) => {
            if (!keys.has(key)) {
                if (item.button.has_key_focus())
                    this.endKeyboard();
                if (this._menuOwner === item)
                    this._destroyMenu();
                if (this._tooltipOwner === item)
                    this.setTooltip(item, false);
                this._items.delete(key);
                if (animate && item.shown) {
                    item.button.reactive = false;
                    this._leaving.push({ item: item, start: this.now(), from: item.shown });
                } else {
                    item.destroy();
                }
            }
        });
        entries.forEach(entry => {
            if (!this._items.has(entry.key))
                this._items.set(entry.key, new DockItem(this, entry));
            this._items.get(entry.key).update(entry, this);
        });

        this._order = entries.map(entry => this._items.get(entry.key));
        // Entries come pinned first (lib/grouping.js).
        const kinds = this._order.map(() => "icon");
        const split = entries.findIndex(entry => !entry.pinned);
        if (split > 0)
            kinds.splice(split, 0, "separator");

        const signature = entries.map(entry => entry.key).concat(kinds).join("\n");
        if (animate && signature !== this._signature) {
            const separator = this._placed.items.find(slot => slot.kind === "separator");
            this._blend = {
                start: this.now(),
                pill: this._placed.dock,
                separator: separator ? separator.rect : null,
                from: new Map()
            };
            this._items.forEach(item => {
                if (item.shown)
                    this._blend.from.set(item, item.shown);
            });
            this._wake();
        }
        this._signature = signature;
        this.rest = Layout.computeRest(kinds, this.tokens,
            this.monitor, this.position, this.edgeInset);
        this._applyRadii();
        this._relayout();
        this._placeReservation();
        if (this._tooltipOwner && !this._order.includes(this._tooltipOwner))
            this.setTooltip(this._tooltipOwner, false);
        this._placeTooltip();
    }

    setTooltip(item, visible) {
        if (!visible) {
            if (this._tooltipOwner === item) {
                this._tooltipOwner = null;
                this.tooltip.remove_all_transitions();
                this.tooltip.hide();
            }
            return;
        }
        if (this._menu && this._menu.isOpen)
            return;
        this._tooltipOwner = item;
        this.tooltip.text = item.entry.name;
        this.tooltip.set_opacity(0);
        this.tooltip.show();
        this._placeTooltip();
        this.tooltip.ease({
            opacity: 255,
            duration: TOOLTIP_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    // Keyboard mode: a modal grab keeps keys on the dock until Escape, an
    // activation or a click elsewhere ends it.
    beginKeyboard() {
        if (this._keyboard || !this._order.length)
            return;
        if (!Main.pushModal(this.actor))
            return;
        this._keyboard = true;
        this._stageEventId = global.stage.connect("captured-event", (stage, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS &&
                !this.actor.contains(event.get_source()))
                this.endKeyboard();
            return Clutter.EVENT_PROPAGATE;
        });
        this._order[0].button.grab_key_focus();
    }

    endKeyboard() {
        if (!this._keyboard)
            return;
        this._keyboard = false;
        global.stage.disconnect(this._stageEventId);
        this._stageEventId = 0;
        Main.popModal(this.actor);
    }

    _onKeyPress(event) {
        if (!this._keyboard)
            return Clutter.EVENT_PROPAGATE;
        const symbol = event.get_key_symbol();
        const index = this._order.findIndex(item => item.button.has_key_focus());
        const vertical = this.position !== "bottom";
        const previous = vertical ? Clutter.KEY_Up : Clutter.KEY_Left;
        const next = vertical ? Clutter.KEY_Down : Clutter.KEY_Right;

        if (symbol === Clutter.KEY_Escape) {
            this.endKeyboard();
        } else if (symbol === previous || symbol === next || symbol === Clutter.KEY_Home ||
            symbol === Clutter.KEY_End) {
            const last = this._order.length - 1;
            const target = symbol === Clutter.KEY_Home ? 0
                : symbol === Clutter.KEY_End ? last
                : Math.min(last, Math.max(0, index + (symbol === next ? 1 : -1)));
            this._order[target].button.grab_key_focus();
        } else {
            // Return and space reach St.Button, which emits "clicked".
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    // SPEC §7: windows, new window, pin toggle and close. Rebuilt on every
    // open so it always reflects the current entry.
    openMenu(item) {
        this._destroyMenu();
        this.setTooltip(item, false);
        const entry = item.entry;
        const actions = this.actions;
        const menu = new DockMenu(item.button, MENU_SIDES[this.position],
            (x, y, width, height) => this._placeMenu(x, y, width, height));
        menu.actor.hide();
        Main.uiGroup.add_actor(menu.actor);
        this._menuManager.addMenu(menu);
        this._menu = menu;
        this._menuOwner = item;

        const windows = entry.windows.map(window => window.metaWindow).filter(Boolean);
        windows.forEach(window =>
            menu.addAction(window.get_title() || entry.name, () => actions.activateWindow(window)));
        if (windows.length)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (entry.app || entry.info)
            menu.addAction(windows.length ? "Nova janela" : "Abrir", () => {
                if (!entry.windows.length)
                    this.startLaunchBounce(item);
                actions.openNewWindow(entry);
            });
        if (entry.desktopFileId)
            menu.addAction(entry.pinned ? "Remover do Dock" : "Manter no Dock", () => actions.togglePin(entry));
        if (windows.length)
            menu.addAction(windows.length > 1 ? "Fechar todas as janelas" : "Fechar",
                () => actions.closeWindows(entry));
        menu.connect("open-state-changed", (m, open) => {
            if (!open)
                this._wake();
        });
        menu.open(true);
    }

    focusMenu() {
        if (this._menu)
            this._menu.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    }

    _placeMenu(x, y, width, height) {
        const [pillX, pillY] = this.pill.get_transformed_position();
        const gap = MENU_GAP * this.scaleFactor;
        if (this.position === "bottom")
            return [x, Math.round(pillY - gap - height)];
        if (this.position === "left")
            return [Math.round(pillX + this.pill.width + gap), y];
        return [Math.round(pillX - gap - width), y];
    }

    _destroyMenu() {
        if (!this._menu)
            return;
        this._menuManager.removeMenu(this._menu);
        this._menu.destroy();
        this._menu = null;
        this._menuOwner = null;
    }

    // Beside the hovered icon on the side away from the edge, kept on screen.
    _placeTooltip() {
        const item = this._tooltipOwner;
        if (!item)
            return;
        const [, width] = this.tooltip.get_preferred_width(-1);
        const [, height] = this.tooltip.get_preferred_height(width);
        const [x, y] = item.button.get_position();
        const size = item.button.width * item.button.scale_x;
        const gap = TOOLTIP_GAP * this.scaleFactor;
        let left;
        let top;
        if (this.position === "bottom") {
            left = x + size / 2 - width / 2;
            top = y - gap - height;
        } else {
            left = this.position === "left" ? x + size + gap : x - gap - width;
            top = y + size / 2 - height / 2;
        }
        left = Math.min(this.monitor.width - width, Math.max(0, left));
        top = Math.min(this.monitor.height - height, Math.max(0, top));
        this.tooltip.set_position(Math.round(left), Math.round(top));
    }

    // SPEC §6: opening an app bounces its icon.
    launchOrActivate(item) {
        if (!item.entry.windows.length)
            this.startLaunchBounce(item);
        this.actions.activate(item.entry, this.monitor.index);
    }

    startLaunchBounce(item) {
        const timing = Animation.TIMING;
        this.startBounce(item, Math.ceil(timing.launchTimeoutMs / timing.bounceMs), true);
    }

    // A bounce already in flight keeps going instead of restarting.
    startBounce(item, count, launch) {
        if (!Main.animations_enabled || item.bounce)
            return;
        item.bounce = { start: this.now(), count: count, launch: launch };
        this._wake();
    }

    now() {
        return GLib.get_monotonic_time() / 1000;
    }

    // Translates bouncing icons away from the edge; true while any bounces.
    _stepBounces() {
        const height = Animation.TIMING.bounceHeight * this.rest.iconSize;
        const sign = this.position === "right" ? -1 : 1;
        let active = false;
        this._order.forEach(item => {
            if (!item.bounce)
                return;
            const elapsed = this.now() - item.bounce.start;
            const lift = Animation.bounce(elapsed, Animation.TIMING.bounceMs, item.bounce.count) * height;
            if (elapsed >= Animation.TIMING.bounceMs * item.bounce.count)
                item.bounce = null;
            else
                active = true;
            if (this.position === "bottom")
                item.button.translation_y = -lift;
            else
                item.button.translation_x = sign * lift;
        });
        return active;
    }

    _menuOpen() {
        return Boolean(this._menu && this._menu.isOpen);
    }

    _wake() {
        if (!this._timeline.is_playing())
            this._timeline.start();
    }

    // Main-axis pointer at rest centers' scale, and whether it is over the
    // dock: the pill at rest, plus the room magnified icons rise into once
    // hovering, so moving onto an enlarged icon keeps the dock magnified.
    _tick(dt) {
        if (!this.rest) {
            this._timeline.stop();
            return;
        }
        const bouncing = this._stepBounces();
        // A menu freezes magnification so it stays next to its icon.
        if (this._menuOpen()) {
            if (!bouncing)
                this._timeline.stop();
            return;
        }
        const [x, y] = global.get_pointer();
        const hovering = this._contains(this._hovering ? this._zone() : this._placed.dock, x, y);
        if (hovering !== this._hovering) {
            this._hovering = hovering;
            this._setRect(this.hitArea, hovering ? this._zone() : this._placed.dock);
        }

        const reduced = !Main.animations_enabled;
        const main = this.position === "bottom" ? x : y;
        const target = hovering ? 1 : 0;
        if (hovering) {
            this._pointer = this._amount === 0 ? main
                : Animation.approach(this._pointer, main, dt, reduced ? 0 : Animation.TIMING.pointerMs);
        }
        this._amount = Animation.approach(this._amount, target, dt, reduced ? 0 : Animation.TIMING.hoverMs);
        if (Animation.settled(this._amount, target))
            this._amount = target;
        this._relayout();

        const still = !bouncing && !this._blend && !this._leaving.length && this._amount === target &&
            (!hovering || Animation.settled(this._pointer, main, 0.1));
        if (still)
            this._timeline.stop();
    }

    _contains(rect, x, y) {
        return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    }

    // The dock grown outwards by how far a fully magnified icon passes the pill.
    _zone() {
        const tokens = this.tokens;
        const ratio = this.rest.ratio;
        const overflow = Math.max(0, (tokens["icon.maxSize"] - tokens["icon.baseSize"] -
            tokens["dock.paddingY"]) * ratio);
        const dock = this._placed.dock;
        if (this.position === "bottom")
            return { x: dock.x, y: dock.y - overflow, width: dock.width, height: dock.height + overflow };
        if (this.position === "left")
            return { x: dock.x, y: dock.y, width: dock.width + overflow, height: dock.height };
        return { x: dock.x - overflow, y: dock.y, width: dock.width + overflow, height: dock.height };
    }

    _relayout() {
        const tokens = this.tokens;
        const ratio = this.rest.ratio;
        const sizes = this._amount > 0
            ? Magnification.sizes(this.rest.centers, this._pointer, this.rest.iconSize,
                tokens["icon.maxSize"] * ratio, tokens["magnification.sigma"] * ratio, this._amount)
            : null;
        this._placed = Layout.place(this.rest, sizes, sizes ? this._pointer : null);
        this._apply(this._placed);
        this._placeTooltip();
    }

    _local(rect) {
        return { x: rect.x - this.monitor.x, y: rect.y - this.monitor.y, width: rect.width, height: rect.height };
    }

    _setRect(actor, rect) {
        const local = this._local(rect);
        actor.set_position(Math.round(local.x), Math.round(local.y));
        actor.set_size(Math.round(local.width), Math.round(local.height));
    }

    // Styles take logical px; the focus ring is drawn on the unscaled button.
    _applyRadii() {
        const radii = Layout.radii(this.rest);
        const px = value => value / this.scaleFactor + "px;";
        this.pill.set_style("border-radius: " + px(radii.dock));
        this._order.forEach(item => {
            item.highlight.set_style("border-radius: " + px(radii.highlight));
            item.button.set_style("border-radius: " +
                px(radii.icon * this.maxIconSize / this.rest.iconSize));
        });
    }

    // Eased 0..1 progress since `start`, over the reorder duration.
    _progress(start) {
        return Animation.easeOutCubic((this.now() - start) / Animation.TIMING.reorderMs);
    }

    _lerpRect(from, to, t) {
        return {
            x: Animation.lerp(from.x, to.x, t),
            y: Animation.lerp(from.y, to.y, t),
            width: Animation.lerp(from.width, to.width, t),
            height: Animation.lerp(from.height, to.height, t)
        };
    }

    // During a reorder, items that stay slide from where they were, new ones
    // grow in place and removed ones shrink where they last stood.
    _apply(placed) {
        const blend = this._blend;
        const t = blend ? this._progress(blend.start) : 1;
        if (t >= 1)
            this._blend = null;
        this._setRect(this.pill, blend ? this._lerpRect(blend.pill, placed.dock, t) : placed.dock);
        this._setRect(this.hitArea, this._hovering ? this._zone() : placed.dock);

        const icons = placed.items.filter(slot => slot.kind === "icon");
        const separator = placed.items.find(slot => slot.kind === "separator");
        this.separator.visible = Boolean(separator);
        if (separator) {
            const from = blend && blend.separator;
            this._setRect(this.separator, from ? this._lerpRect(from, separator.rect, t) : separator.rect);
            this.separator.opacity = blend && !from ? Math.round(255 * t) : 255;
        }

        const diameter = icons.length ? icons[0].indicator.diameter : 0;
        icons.forEach((slot, index) => {
            const item = this._order[index];
            const rect = this._local(slot.rect);
            const from = blend && blend.from.get(item);
            let shown = { x: rect.x, y: rect.y, size: slot.size };
            if (from) {
                shown = {
                    x: Animation.lerp(from.x, rect.x, t),
                    y: Animation.lerp(from.y, rect.y, t),
                    size: Animation.lerp(from.size, slot.size, t)
                };
            } else if (blend) {
                shown = this._shrink(shown, t);
            }
            this._placeIcon(item, shown, blend && !from ? t : 1);

            // The dot follows the icon along the dock only.
            const center = slot.indicator.center;
            const shift = shown.x + shown.size / 2 - (rect.x + slot.size / 2);
            const lift = shown.y + shown.size / 2 - (rect.y + slot.size / 2);
            item.indicator.set_size(Math.round(diameter), Math.round(diameter));
            item.indicator.set_position(
                Math.round(center.x - this.monitor.x - diameter / 2 + (this.position === "bottom" ? shift : 0)),
                Math.round(center.y - this.monitor.y - diameter / 2 + (this.position === "bottom" ? 0 : lift)));
            item.indicator.set_style("border-radius: " + diameter / 2 / this.scaleFactor + "px;");
        });

        this._leaving = this._leaving.filter(leaving => {
            const progress = this._progress(leaving.start);
            if (progress >= 1) {
                leaving.item.destroy();
                return false;
            }
            this._placeIcon(leaving.item, this._shrink(leaving.from, 1 - progress), 1 - progress);
            leaving.item.indicator.opacity = Math.round(255 * (1 - progress));
            return true;
        });
    }

    // `shown` scaled by `factor` around its center.
    _shrink(shown, factor) {
        const size = shown.size * factor;
        return { x: shown.x + (shown.size - size) / 2, y: shown.y + (shown.size - size) / 2, size: size };
    }

    // shown: local { x, y, size } of the icon.
    _placeIcon(item, shown, opacity) {
        item.shown = shown;
        item.button.set_position(shown.x, shown.y);
        item.button.set_scale(shown.size / this.maxIconSize, shown.size / this.maxIconSize);
        item.button.opacity = Math.round(255 * opacity);
        const inset = this.tokens["highlight.inset"] * this.rest.ratio;
        item.highlight.set_position(Math.round(shown.x - inset), Math.round(shown.y - inset));
        item.highlight.set_size(Math.round(shown.size + 2 * inset), Math.round(shown.size + 2 * inset));
        item.highlight.opacity = Math.round(255 * opacity);
    }

    // The strut covers the whole edge strip, panels included, up to the rest
    // dock's far side plus the same gap the dock keeps from its edge.
    _placeReservation() {
        const thickness = Math.ceil(this.edgeInset + 2 * this.tokens["dock.bottomOffset"] +
            this.rest.crossLength);
        const m = this.monitor;
        if (this.position === "bottom") {
            this.reservation.set_position(m.x, m.y + m.height - thickness);
            this.reservation.set_size(m.width, thickness);
        } else {
            this.reservation.set_position(
                this.position === "left" ? m.x : m.x + m.width - thickness, m.y);
            this.reservation.set_size(thickness, m.height);
        }
    }

    destroy() {
        this._timeline.disconnect(this._timelineId);
        this._timeline.stop();
        this.endKeyboard();
        this._destroyMenu();
        this._items.forEach(item => item.destroy());
        this._items.clear();
        this._leaving.forEach(leaving => leaving.item.destroy());
        this._leaving = [];
        Main.layoutManager.untrackChrome(this.hitArea);
        Main.layoutManager.removeChrome(this.actor);
        Main.layoutManager.removeChrome(this.reservation);
        this.actor.destroy();
        this.reservation.destroy();
    }
}
