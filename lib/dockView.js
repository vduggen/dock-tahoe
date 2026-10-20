// Dock view for one monitor: St actors placed from lib/layout.js geometry.
//
// Actors:
//   reservation  invisible strip along the whole monitor edge; publishes the
//                strut so maximized windows stop before the dock.
//   actor        monitor-sized, non-reactive container for every visible
//                piece; children use monitor-relative coordinates. Clips to
//                its monitor.
//   content      the dock itself inside actor; auto-hide slides it past the
//                edge.
//   hitArea      invisible child that alone joins the stage input region, so
//                clicks elsewhere along the edge still reach the windows.
//   trigger      with auto-hide, a thin strip at the edge that reveals the
//                hidden dock when the pointer reaches it.
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
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Animation = require("./lib/animation.js");
const Badges = require("./lib/badges.js");
const { Bubble } = require("./lib/bubbleActor.js");
const BubbleShape = require("./lib/bubble.js");
const Grouping = require("./lib/grouping.js");
const Layout = require("./lib/layout.js");
const Magnification = require("./lib/magnification.js");
const Tokens = require("./lib/tokens.js");
const { WindowPreview } = require("./lib/windowPreview.js");

const ICON_FALLBACK = "application-x-executable";
// Starting points (SPEC §6 "Tooltip: medir no Tahoe").
const TOOLTIP_GAP = 10;
const TOOLTIP_FADE_MS = 120;
// Window previews: hover this long on an icon with windows to show them,
// and they stay this long after the pointer leaves both icon and preview.
const PREVIEW_DELAY_MS = 450;
const PREVIEW_GRACE_MS = 250;
// Side of the menu that faces its icon.
const MENU_SIDES = { bottom: St.Side.BOTTOM, left: St.Side.LEFT, right: St.Side.RIGHT };
const MENU_GAP = 8;
// .tahoe-menu .popup-menu-content padding in stylesheet.css.
const MENU_PADDING = 5;
// Space between the icon and its keyboard focus ring, in logical px.
const FOCUS_RING_GAP = 3;
// The dragged copy of a pinned app, away enough to be removed on drop.
const REMOVE_OPACITY = 110;
// How far the .tahoe-dock box-shadow reaches past the glass, in logical px.
const GLASS_SHADOW = 40;
// Auto-hide reveal strip at the screen edge, in logical px.
const TRIGGER_THICKNESS = 2;

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
        this._view = view;

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
        // The badge lives inside the button, so it scales and bounces with the icon.
        const face = new St.Widget();
        // Keyboard focus: a ring just outside the icon (stylesheet.css).
        this.ringGap = Math.round(FOCUS_RING_GAP * view.scaleFactor);
        this.ring = new St.Widget({ style_class: "tahoe-focus-ring", visible: false });
        this.ring.set_position(-this.ringGap, -this.ringGap);
        this.ring.set_size(view.maxIconSize + 2 * this.ringGap, view.maxIconSize + 2 * this.ringGap);
        face.add_child(this.ring);
        this.icon = this._createIcon(entry, view.maxIconSize / view.scaleFactor);
        face.add_child(this.icon);
        this.badge = this._createBadge(view);
        face.add_child(this.badge);
        this.button.set_child(face);
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
        this.button.connect("notify::hover", () => {
            view.setTooltip(this, this.button.hover);
            view.queuePreview();
        });
        view.watchPointer(this.button);
        // Dragging reorders the pinned apps (SPEC §7). DND reads
        // getDragActor() through the button's delegate.
        this.button._delegate = this;
        this._draggable = DND.makeDraggable(this.button);
        this._draggable.connect("drag-begin", () => view.beginDrag(this));
        // A cancel snaps the copy back, so the item goes home first.
        this._draggable.connect("drag-cancelled", () => view.dragHome(this));
        this._draggable.connect("drag-end", () => view.endDrag(this));
        this.button.connect("key-focus-in", () => {
            this.ring.show();
            view.setTooltip(this, true);
        });
        this.button.connect("key-focus-out", () => {
            this.ring.hide();
            view.setTooltip(this, false);
        });

        this.indicator = new St.Widget({ style_class: "tahoe-indicator", visible: false });

        view.content.add_child(this.indicator);
        view.content.add_child(this.button);
    }

    // A copy of the icon at its shown size follows the pointer; the item
    // itself stays as the gap it will drop into.
    getDragActor() {
        const size = this.shown ? this.shown.size : this._view.rest.iconSize;
        return this._createIcon(this.entry, size / this._view.scaleFactor);
    }

    getDragActorSource() {
        return this.button;
    }

    _createIcon(entry, logicalSize) {
        const gicon = entry.gicon || (entry.info ? entry.info.get_icon() : null);
        if (gicon)
            return new St.Icon({ gicon: gicon, icon_size: logicalSize, style_class: "tahoe-icon" });
        if (entry.app)
            return entry.app.create_icon_texture(logicalSize);
        return new St.Icon({ icon_name: ICON_FALLBACK, icon_size: logicalSize, style_class: "tahoe-icon" });
    }

    // A red pill at the icon's top-right corner (lib/badges.js GEOMETRY):
    // round for one digit, wider for more.
    _createBadge(view) {
        const icon = view.maxIconSize / view.scaleFactor;
        const height = Math.round(icon * Badges.GEOMETRY.height);
        const padding = Math.round(height * 0.22);
        const overhang = view.maxIconSize * Badges.GEOMETRY.overhang;
        this.badgeLabel = new St.Label({
            style_class: "tahoe-badge-label",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        const badge = new St.BoxLayout({ style_class: "tahoe-badge", visible: false });
        badge.add_child(this.badgeLabel);
        // St's min-width is the content box, so it leaves out the padding.
        badge.set_style("height: " + height + "px; min-width: " + (height - 2 * padding) + "px;" +
            " border-radius: " + height / 2 + "px; padding: 0 " + padding + "px;" +
            " font-size: " + Math.round(icon * Badges.GEOMETRY.font) + "px;");
        badge.connect("notify::width", () =>
            badge.set_position(Math.round(view.maxIconSize - badge.width + overhang), Math.round(-overhang)));
        return badge;
    }

    update(entry, view) {
        const wasAttention = Boolean(this.entry.facts && this.entry.facts.attention);
        // The trash swaps between its empty and full icons.
        if (entry.gicon && this.icon instanceof St.Icon && !entry.gicon.equal(this.icon.gicon))
            this.icon.gicon = entry.gicon;
        this.entry = entry;
        // Apps with a desktop file drag: pinned ones reorder, the others get
        // pinned where they drop. The file manager stays first.
        this._draggable.inhibit = !entry.desktopFileId || Boolean(entry.trash) || Boolean(entry.permanent);
        this.button.accessible_name = entry.badge ? entry.name + " (" + entry.badge + ")" : entry.name;
        this.indicator.visible = entry.facts.hasWindows;
        this.badge.visible = Boolean(entry.badge);
        this.badgeLabel.text = entry.badge || "";
        // SPEC §4: focus has its own cue, the dot's color; the running dot
        // alone is not focus.
        if (entry.facts.focused)
            this.indicator.add_style_class_name("focused");
        else
            this.indicator.remove_style_class_name("focused");
        // A launch bounces until its first window, finishing the bounce in the air.
        if (this.bounce && this.bounce.launch &&
            (entry.facts.hasWindows || entry.windows.length > this.bounce.windows))
            this.bounce.count = Math.max(1, Math.ceil((view.now() - this.bounce.start) / Animation.TIMING.bounceMs));
        if (entry.facts.attention && !wasAttention)
            view.startBounce(this, Animation.TIMING.attentionBounces, false);
    }

    destroy() {
        this.button.destroy();
        this.indicator.destroy();
    }
}

class DockView {
    // actions: { activate(entry, monitorIndex) }, implemented by the controller.
    // autohide: no strut; the dock slides away until the pointer hits the edge.
    // overrides: token overrides from the appearance settings.
    constructor(monitor, position, scaleFactor, edgeInset, autohide, overrides, actions) {
        this.monitor = monitor;
        this.autohide = autohide;
        this.actions = actions;
        this.position = position;
        this.edgeInset = edgeInset;
        this.scaleFactor = scaleFactor;
        this.tokens = Tokens.resolve(overrides, scaleFactor);
        this.maxIconSize = this.tokens["icon.maxSize"];
        this._items = new Map();
        this._order = [];
        // Entries as the controller last sent them, and the drag in flight
        // (see _dragFor()).
        this._entries = [];
        this._drag = null;
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
        // Auto-hide: eased 0..1 reveal, and when the dock last had a reason to show.
        this._reveal = autohide ? 0 : 1;
        this._wantedAt = 0;
        this._wanted = false;
        this._timeline = new Clutter.Timeline({ duration: 1000, repeat_count: -1 });
        this._timelineId = this._timeline.connect("new-frame", () => this._tick(this._timeline.get_delta()));

        this.actor = new St.Widget({ name: "tahoe-dock-container", reactive: false });
        // Cinnamon convention; also lets Looking Glass reach the view.
        this.actor._delegate = this;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);
        this.actor.clip_to_allocation = true;
        this.content = new St.Widget({ reactive: false });
        this.content.set_size(monitor.width, monitor.height);
        this.actor.add_child(this.content);

        // The dock's rect, unstyled. The glass is drawn by two copies of a
        // fixed length, each clipped to one half of the rect: a widget with a
        // box-shadow re-blurs it on the CPU at every size change, which made
        // magnification stutter; moving and clipping costs nothing.
        this.pill = new St.Widget();
        this._glass = [0, 1].map(() => {
            const clip = new St.Widget({ clip_to_allocation: true });
            clip.add_child(new St.Widget({ style_class: "tahoe-dock" }));
            return clip;
        });
        // Reactive so the gaps between icons also count as the dock.
        this.hitArea = new St.Widget({ reactive: true });
        // Lines between sections (Layout.sections), by role: "running" and
        // "trash". Created on first use.
        this._separators = new Map();
        this._roles = [];
        this.tooltipLabel = new St.Label({ style_class: "tahoe-tooltip-label" });
        this.tooltip = new St.Bin({ style_class: "tahoe-tooltip", child: this.tooltipLabel, visible: false });
        this._tooltipBubble = new Bubble(this.tooltip, BubbleShape.ARROW_SIDES[position], this.tokens);
        this.tooltip.set_style(this._tooltipBubble.padding(scaleFactor));
        this._tooltipOwner = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = null;
        this._menuOwner = null;
        this._keyboard = false;
        this._stageEventId = 0;
        this.actor.connect("key-press-event", (actor, event) => this._onKeyPress(event));
        this.watchPointer(this.hitArea);
        this._glass.forEach(clip => this.content.add_child(clip));
        this.content.add_child(this.pill);
        this.content.add_child(this.hitArea);
        this.actor.add_child(this.tooltip);
        this._preview = new WindowPreview(this.actor, monitor, position, scaleFactor, this.tokens, window => {
            this.actions.endPeek(window);
            this.hidePreview();
            this.actions.activateWindow(window);
        }, window => this.actions.peekWindow(window));
        this._previewTimer = 0;
        this._preview.actor.connect("notify::hover", () => {
            // Leaving the previews ends the look at a window.
            if (!this._preview.actor.hover)
                this.actions.endPeek(null);
            this.queuePreview();
        });
        this.watchPointer(this._preview.actor);

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

        this.trigger = new St.Widget({ name: "tahoe-dock-trigger", reactive: true, visible: false });
        this.watchPointer(this.trigger);
        Main.layoutManager.addChrome(this.trigger, {
            affectsStruts: false,
            affectsInputRegion: true,
            visibleInFullscreen: false
        });
    }

    // entries: [{ key, name, app, info, facts }] in dock order.
    update(entries) {
        this._entries = entries;
        // A drop shows its result until the controller's next update has it.
        if (this._drag && this._drag.ended)
            this._drag = null;
        if (this._drag)
            entries = this._dragOrder(entries);
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
                if (this._preview.owner === item)
                    this.hidePreview();
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
        // Entries come pinned first (lib/grouping.js), the trash last.
        const { kinds, roles } = Layout.sections(entries);

        const signature = entries.map(entry => entry.key).concat(roles).join("\n");
        if (animate && signature !== this._signature) {
            const separators = new Map();
            this._placed.items.filter(slot => slot.kind === "separator")
                .forEach((slot, index) => separators.set(this._roles[index], slot.rect));
            this._blend = {
                start: this.now(),
                pill: this._placed.dock,
                separators: separators,
                from: new Map()
            };
            this._items.forEach(item => {
                if (item.shown)
                    this._blend.from.set(item, item.shown);
            });
            this._wake();
        }
        this._signature = signature;
        this._roles = roles;
        this.rest = Layout.computeRest(kinds, this.tokens,
            this.monitor, this.position, this.edgeInset);
        this._applyRadii();
        this._relayout();
        this._placeReservation();
        const trigger = this._triggerRect();
        this.trigger.set_position(trigger.x, trigger.y);
        this.trigger.set_size(trigger.width, trigger.height);
        this._applyReveal();
        if (this._tooltipOwner && !this._order.includes(this._tooltipOwner))
            this.setTooltip(this._tooltipOwner, false);
        this._placeTooltip();
        this._preview.refresh();
        this._placePreview();
    }

    // The dragged app at its drop index among the pinned entries that come
    // first, shown as pinned; at home (index null) when not pinned yet.
    _dragOrder(entries) {
        const drag = this._drag;
        if (drag.index === null)
            return entries;
        const dragged = drag.entry || entries.find(entry => entry.key === drag.key);
        if (!dragged)
            return entries;
        const rest = entries.filter(entry => entry.key !== drag.key);
        const pinned = rest.filter(entry => entry.pinned && !entry.trash).length;
        rest.splice(Math.min(drag.index, pinned), 0,
            dragged.pinned ? dragged : Object.assign({}, dragged, { pinned: true }));
        return rest;
    }

    // The drag in flight, started for `source` if it brings an app this dock
    // can pin: { source, key, entry, home, index, dropped, ended }. key: the
    // dock item that stands for it, an empty slot while dragging; entry: a
    // placeholder for apps from outside the dock; home: its pinned index
    // before the drag, null if not pinned.
    _dragFor(source) {
        if (this._drag)
            return this._drag.source === source ? this._drag : null;
        let drag;
        if (source instanceof DockItem && source._view === this) {
            const home = source.entry.pinned ? this._pinnedItems().indexOf(source) : null;
            drag = { key: source.key, entry: null, home: home, end: home === null ? null : this._pinnedEnd() };
        } else {
            const entry = this._placeholder(source);
            if (!entry)
                return null;
            drag = { key: entry.key, entry: entry, home: null };
            // Foreign draggables only tell their own listeners when they end.
            const draggable = source._draggable;
            if (draggable) {
                const id = draggable.connect("drag-end", () => {
                    draggable.disconnect(id);
                    this.endDrag(source);
                });
            }
        }
        this._drag = Object.assign(drag, { source: source, index: drag.home, dropped: false, ended: false });
        this.endKeyboard();
        this._destroyMenu();
        this.setTooltip(this._tooltipOwner, false);
        this.hidePreview();
        return this._drag;
    }

    // Main-axis rest coordinate halfway between the last pinned icon and the
    // next element (a running app or the trash), or null if none follows.
    // Kept from the drag's start, so the gap the drag opens never moves it.
    _pinnedEnd() {
        const centers = this.rest.centers.filter(center => center !== null);
        const last = this._pinnedItems().length - 1;
        return last >= 0 && last + 1 < centers.length ? (centers[last] + centers[last + 1]) / 2 : null;
    }

    // An entry for an app dragged from elsewhere: another monitor's dock or
    // Cinnamon's menu (get_app_id()). Null when it is already pinned here.
    _placeholder(source) {
        let app = null;
        if (source instanceof DockItem)
            app = source.entry.desktopFileId && !source.entry.pinned ? source.entry.app : null;
        else if (source && source.app && typeof source.get_app_id === "function")
            app = source.app;
        const id = app && app.get_id();
        if (!id || this._order.some(item => item.entry.pinned && item.entry.desktopFileId === id))
            return null;
        const info = app.get_app_info();
        return {
            key: "pinned:" + Grouping.normalizeId(id),
            pinned: true,
            desktopFileId: id,
            app: app,
            info: info,
            name: app.get_name(),
            windows: [],
            localWindows: [],
            facts: { pinned: true, running: false, hasWindows: false, focused: false, minimized: false, attention: false },
            badge: null
        };
    }

    beginDrag(item) {
        if (this._dragFor(item))
            this._relayout();
    }

    dragHome(source) {
        const drag = this._drag;
        if (drag && drag.source === source && drag.index !== drag.home) {
            drag.index = drag.home;
            this.update(this._entries);
        }
    }

    endDrag(source) {
        const drag = this._drag;
        if (!drag || drag.source !== source)
            return;
        if (drag.dropped) {
            // Saved: keep the new order until the controller sends it.
            drag.ended = true;
            this._relayout();
        } else {
            this._drag = null;
            this.update(this._entries);
        }
        this._wake();
    }

    // Stage rect of the icon showing `metaWindow` on this dock, or null.
    iconRect(metaWindow) {
        const item = this._order.find(candidate =>
            candidate.entry.localWindows.some(window => window.metaWindow === metaWindow));
        if (!item)
            return null;
        const [x, y] = item.button.get_transformed_position();
        const [width, height] = item.button.get_transformed_size();
        return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    }

    _pinnedItems() {
        return this._order.filter(item => item.entry.pinned && !item.entry.trash);
    }

    // Whether dropping the drag at stage x, y removes its pinned app (SPEC
    // §7 "Arrastar para fora"): a pinned item of this dock, other than the
    // file manager, dropped past the pinned apps or at least an icon's
    // length away from the dock.
    _removes(drag, x, y) {
        const item = this._items.get(drag.key);
        if (drag.entry || drag.home === null || !item || item.entry.permanent)
            return false;
        const zone = this._zone();
        if (drag.end !== null && this._contains(zone, x, y) && (this.position === "bottom" ? x : y) > drag.end)
            return true;
        const margin = this.rest.iconSize;
        return !this._contains({
            x: zone.x - margin,
            y: zone.y - margin,
            width: zone.width + 2 * margin,
            height: zone.height + 2 * margin
        }, x, y);
    }

    // DND target, from the view actor's delegate, which covers the whole
    // monitor. x, y: monitor-local. Over the dock the dragged icon opens a
    // gap where it would land; away from it the item goes back home. Where
    // dropping removes it, the copy fades.
    handleDragOver(source, actor, x, y) {
        const drag = this._dragFor(source);
        if (!drag || drag.ended)
            return DND.DragMotionResult.NO_DROP;
        const removes = this._removes(drag, x + this.monitor.x, y + this.monitor.y);
        actor.opacity = removes ? REMOVE_OPACITY : 255;
        // The drag's modal grab keeps pointer events off the dock's actors,
        // so motion over it wakes magnification from here.
        this._wake();
        const inside = this._contains(this._zone(), x + this.monitor.x, y + this.monitor.y);
        let index = drag.home;
        if (inside) {
            const main = this.position === "bottom" ? x + this.monitor.x : y + this.monitor.y;
            const centers = this.rest.centers.filter(center => center !== null)
                .filter((center, slot) => this._order[slot].key !== drag.key &&
                    this._order[slot].entry.pinned && !this._order[slot].entry.trash);
            // Nothing drops before the permanent file manager; past the
            // pinned apps the gap waits at their end.
            index = removes ? centers.length : Math.max(
                this._pinnedItems().filter(item => item.entry.permanent && item.key !== drag.key).length,
                Layout.dropIndex(centers, main));
        }
        if (index !== drag.index) {
            drag.index = index;
            this.update(this._entries);
        }
        return inside || removes ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.NO_DROP;
    }

    acceptDrop(source, actor, x, y) {
        const drag = this._drag;
        if (!drag || drag.source !== source || drag.ended)
            return false;
        if (this._removes(drag, x + this.monitor.x, y + this.monitor.y)) {
            // The copy vanishes where it was dropped; the item leaves with
            // the controller's next update.
            drag.index = null;
            this.actions.togglePin(this._items.get(drag.key).entry);
            return true;
        }
        if (drag.index === null || !this._contains(this._zone(), x + this.monitor.x, y + this.monitor.y))
            return false;
        if (drag.index !== drag.home) {
            drag.dropped = true;
            this.actions.reorderPinned(this._pinnedItems().map(item => item.entry.desktopFileId));
        }
        return true;
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
        if (this._menuOpen() || this._preview.owner === item || this._drag)
            return;
        this._tooltipOwner = item;
        this.tooltipLabel.text = item.entry.name;
        this.tooltip.set_opacity(0);
        this.tooltip.show();
        this._placeTooltip();
        this.tooltip.ease({
            opacity: 255,
            duration: TOOLTIP_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    // Hover intent: an icon with windows hovered for PREVIEW_DELAY_MS shows
    // them; once shown, moving to another such icon switches at once, and
    // leaving both icon and preview hides them after PREVIEW_GRACE_MS.
    queuePreview() {
        this._clearPreviewTimer();
        const hovered = this._order.find(item => item.button.hover);
        const owner = this._preview.owner;
        if (this._preview.actor.hover || (owner && hovered === owner))
            return;
        let delay;
        if (hovered && this._previewable(hovered))
            delay = owner ? 0 : PREVIEW_DELAY_MS;
        else if (owner)
            delay = PREVIEW_GRACE_MS;
        else
            return;
        if (!delay) {
            this._syncPreview();
            return;
        }
        this._previewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._previewTimer = 0;
            this._syncPreview();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Only items with windows on this monitor, the ones whose dot is lit.
    _previewable(item) {
        return !item.entry.trash &&
            item.entry.localWindows.some(window => window.metaWindow);
    }

    _syncPreview() {
        if (this._preview.actor.hover)
            return;
        const hovered = this._order.find(item => item.button.hover);
        if (!hovered || !this._previewable(hovered) || this._menuOpen() || this._keyboard || this._drag) {
            this.hidePreview();
            return;
        }
        this._showPreview(hovered);
    }

    _showPreview(item) {
        this._clearPreviewTimer();
        this.setTooltip(item, false);
        this._preview.show(item);
        this._placePreview();
        this._wake();
    }

    hidePreview() {
        this._clearPreviewTimer();
        if (!this._preview.owner)
            return;
        this.actions.endPeek(null);
        this._preview.hide();
        this._wake();
    }

    _clearPreviewTimer() {
        if (this._previewTimer) {
            GLib.source_remove(this._previewTimer);
            this._previewTimer = 0;
        }
    }

    // Keyboard mode: a modal grab keeps keys on the dock until Escape, an
    // activation or a click elsewhere ends it. atEnd: focus the last icon.
    beginKeyboard(atEnd) {
        if (this._keyboard || !this._order.length)
            return;
        if (!Main.pushModal(this.actor))
            return;
        this._keyboard = true;
        this.hidePreview();
        this._stageEventId = global.stage.connect("captured-event", (stage, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS &&
                !this.actor.contains(event.get_source()))
                this.endKeyboard();
            return Clutter.EVENT_PROPAGATE;
        });
        this._order[atEnd ? this._order.length - 1 : 0].button.grab_key_focus();
        this._wake();
    }

    endKeyboard() {
        if (!this._keyboard)
            return;
        this._keyboard = false;
        global.stage.disconnect(this._stageEventId);
        this._stageEventId = 0;
        Main.popModal(this.actor);
        this._wake();
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
            // Past either end, focus moves on to the next dock (controller).
            const step = symbol === next ? 1 : symbol === previous ? -1 : 0;
            if (step && index + step !== Math.min(last, Math.max(0, index + step))) {
                this.actions.keyboardStep(this, step);
                return Clutter.EVENT_STOP;
            }
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
        this.hidePreview();
        const entry = item.entry;
        const actions = this.actions;
        const menu = new DockMenu(item.button, MENU_SIDES[this.position],
            (x, y, width, height) => this._placeMenu(x, y, width, height));
        menu.setCustomStyleClass("tahoe-menu");
        this._menuBubble = new Bubble(menu.actor, BubbleShape.ARROW_SIDES[this.position], this.tokens);
        // PopupMenu rewrites actor.style (max-height) on open, so the arrow's
        // room goes on the content, on top of its stylesheet padding.
        menu.box.set_style(this._menuBubble.padding(this.scaleFactor, MENU_PADDING));
        menu.actor.hide();
        Main.uiGroup.add_actor(menu.actor);
        this._menuManager.addMenu(menu);
        this._menu = menu;
        this._menuOwner = item;

        if (entry.trash) {
            menu.addAction("Abrir", () => actions.openTrash());
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            // Greyed out when empty, as in the macOS Dock.
            menu.addAction("Esvaziar Lixeira", () => actions.emptyTrash()).setSensitive(entry.full);
            this._openMenu(menu);
            return;
        }

        // This monitor's windows; the others belong to their own dock.
        const windows = entry.localWindows.map(window => window.metaWindow).filter(Boolean);
        windows.forEach(window =>
            menu.addAction(window.get_title() || entry.name, () => actions.activateWindow(window)));
        if (windows.length)
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // The file manager opens straight into a favorite folder; a heading
        // per section sets them apart from the window titles above.
        const sections = this.actions.folderShortcuts(entry);
        (sections || []).forEach(section => {
            const heading = new PopupMenu.PopupMenuItem(section.title, { reactive: false });
            heading.actor.add_style_class_name("tahoe-menu-heading");
            menu.addMenuItem(heading);
            section.folders.forEach(folder => menu.addAction(folder.name, () => {
                if (!entry.windows.length)
                    this.startLaunchBounce(item);
                this.actions.openFolder(entry, folder.uri, this.monitor.index);
            }));
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        });

        if (entry.app || entry.info)
            menu.addAction(windows.length ? "Nova janela" : "Abrir", () => {
                if (!entry.windows.length)
                    this.startLaunchBounce(item);
                actions.openNewWindow(entry, this.monitor.index);
            });
        if (entry.desktopFileId && !entry.permanent)
            menu.addAction(entry.pinned ? "Remover do Dock" : "Manter no Dock", () => actions.togglePin(entry));
        if (windows.length)
            menu.addAction(windows.length > 1 ? "Fechar todas as janelas" : "Fechar",
                () => actions.closeWindows(entry));
        this._openMenu(menu);
    }

    _openMenu(menu) {
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

    // The arrow points at the icon's center.
    _placeMenu(x, y, width, height) {
        const [pillX, pillY] = this.pill.get_transformed_position();
        const gap = MENU_GAP * this.scaleFactor;
        let placed;
        if (this.position === "bottom")
            placed = [x, Math.round(pillY - gap - height)];
        else if (this.position === "left")
            placed = [Math.round(pillX + this.pill.width + gap), y];
        else
            placed = [Math.round(pillX - gap - width), y];
        const owner = this._menuOwner;
        if (owner && this._menuBubble) {
            const [iconX, iconY] = owner.button.get_transformed_position();
            const [iconWidth, iconHeight] = owner.button.get_transformed_size();
            this._menuBubble.setTip(this.position === "bottom"
                ? iconX + iconWidth / 2 - placed[0]
                : iconY + iconHeight / 2 - placed[1]);
        }
        return placed;
    }

    _destroyMenu() {
        if (!this._menu)
            return;
        this._menuManager.removeMenu(this._menu);
        this._menu.destroy();
        this._menu = null;
        this._menuBubble = null;
        this._menuOwner = null;
    }

    _placeTooltip() {
        if (this._tooltipOwner)
            this._placeBeside(this.tooltip, this._tooltipBubble, this._tooltipOwner);
    }

    _placePreview() {
        if (this._preview.owner)
            this._placeBeside(this._preview.actor, this._preview.bubble, this._preview.owner);
    }

    // Beside `item`'s icon on the side away from the edge, kept on screen,
    // with the bubble's arrow on the icon's center.
    _placeBeside(actor, bubble, item) {
        const [, width] = actor.get_preferred_width(-1);
        const [, height] = actor.get_preferred_height(width);
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
        actor.set_position(Math.round(left), Math.round(top));
        bubble.setTip(this.position === "bottom"
            ? x + size / 2 - Math.round(left)
            : y + size / 2 - Math.round(top));
    }

    // SPEC §6: opening an app bounces its icon.
    // Mirrors the controller's activate(): no window on this monitor means a
    // launch or a new window, except for window-backed apps; several windows
    // show their previews to pick one instead.
    launchOrActivate(item) {
        const entry = item.entry;
        // Several windows here: the previews, or from the keyboard (previews
        // take no keys) the menu, list them to pick one.
        if (entry.localWindows.filter(window => window.metaWindow).length > 1) {
            if (!this._keyboard && this._previewable(item)) {
                this._showPreview(item);
            } else {
                this.hidePreview();
                this.openMenu(item);
            }
            return;
        }
        this.hidePreview();
        // The trash brings forward a window already showing it.
        if (entry.trash && !entry.windows.length) {
            this.actions.openTrash();
            return;
        }
        if (!entry.facts.hasWindows && (entry.desktopFileId || !entry.windows.length))
            this.startLaunchBounce(item);
        this.actions.activate(item.entry, this.monitor.index);
    }

    startLaunchBounce(item) {
        const timing = Animation.TIMING;
        this.startBounce(item, Math.ceil(timing.launchTimeoutMs / timing.bounceMs), true);
        // It ends when a window shows up here or anywhere new (update()).
        if (item.bounce && item.bounce.launch)
            item.bounce.windows = item.entry.windows.length;
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

    // Clutter only emits events on reactive actors, so the non-reactive
    // containers never see them: every reactive piece reports itself.
    watchPointer(actor) {
        ["enter-event", "leave-event", "motion-event"].forEach(signal =>
            actor.connect(signal, () => {
                this._wake();
                return Clutter.EVENT_PROPAGATE;
            }));
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
        // Over the previews, icons hold still under them.
        const previewing = this._preview.actor.hover;
        const hovering = this._reveal > 0 && (previewing ||
            this._contains(this._hovering ? this._zone() : this._placed.dock, x, y));
        if (hovering !== this._hovering) {
            this._hovering = hovering;
            this._setRect(this.hitArea, hovering ? this._zone() : this._placed.dock);
        }

        const reduced = !Main.animations_enabled;
        const revealing = this._stepReveal(dt, reduced,
            hovering || this._keyboard || (this.autohide && this._contains(this._triggerRect(), x, y)));
        const main = this.position === "bottom" ? x : y;
        const target = hovering ? 1 : 0;
        if (hovering && !previewing) {
            this._pointer = this._amount === 0 ? main
                : Animation.approach(this._pointer, main, dt, reduced ? 0 : Animation.TIMING.pointerMs);
        }
        this._amount = Animation.approach(this._amount, target, dt, reduced ? 0 : Animation.TIMING.hoverMs);
        if (Animation.settled(this._amount, target))
            this._amount = target;
        this._relayout();

        const still = !revealing && !bouncing && !this._blend && !this._leaving.length && this._amount === target &&
            (!hovering || previewing || Animation.settled(this._pointer, main, 0.1));
        if (still)
            this._timeline.stop();
    }

    // Auto-hide (SPEC §6): shown while wanted and for a short delay after,
    // then slid past the edge. Returns true while it still has to change.
    _stepReveal(dt, reduced, wanted) {
        if (!this.autohide)
            return false;
        const now = this.now();
        // The timeline sleeps while nothing moves, so the delay starts at
        // the first frame that finds the dock unwanted.
        if (wanted || this._wanted)
            this._wantedAt = now;
        this._wanted = wanted;
        const waiting = now - this._wantedAt < Animation.TIMING.hideDelayMs;
        const target = wanted || waiting ? 1 : 0;
        this._reveal = Animation.approach(this._reveal, target, dt, reduced ? 0 : Animation.TIMING.revealMs);
        if (Animation.settled(this._reveal, target))
            this._reveal = target;
        this._applyReveal();
        return (!wanted && waiting) || this._reveal !== target;
    }

    // Only the shown dock takes input; the edge trigger always does, so
    // leaving the dock from the edge is noticed too.
    _applyReveal() {
        const distance = (1 - this._reveal) * (this.edgeInset + this.tokens["dock.bottomOffset"] +
            this.rest.crossLength);
        this.content.translation_y = this.position === "bottom" ? distance : 0;
        this.content.translation_x = this.position === "left" ? -distance
            : this.position === "right" ? distance : 0;
        this.hitArea.visible = this._reveal === 1 || this._hovering;
        this.trigger.visible = this.autohide;
    }

    // Edge strip along the rest dock, just past any panel on that edge.
    _triggerRect() {
        const rest = this.rest;
        const thickness = Math.max(1, Math.round(TRIGGER_THICKNESS * this.scaleFactor));
        const m = this.monitor;
        if (this.position === "bottom")
            return { x: rest.start, y: m.y + m.height - this.edgeInset - thickness, width: rest.length, height: thickness };
        return {
            x: this.position === "left" ? m.x + this.edgeInset : m.x + m.width - this.edgeInset - thickness,
            y: rest.start,
            width: thickness,
            height: rest.length
        };
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
        this._placePreview();
    }

    _local(rect) {
        return { x: rect.x - this.monitor.x, y: rect.y - this.monitor.y, width: rect.width, height: rect.height };
    }

    _setRect(actor, rect) {
        const local = this._local(rect);
        actor.set_position(Math.round(local.x), Math.round(local.y));
        actor.set_size(Math.round(local.width), Math.round(local.height));
    }

    // The first glass copy starts at the dock's start and shows up to its
    // middle, the second ends at the dock's end and shows the rest; both are
    // as long as the whole area, so their rounded ends never reach the seam.
    // The clips reach past the dock only by the shadow, so each frame
    // redraws just the dock.
    _placePill(rect) {
        this._setRect(this.pill, rect);
        const local = this._local(rect);
        const bottom = this.position === "bottom";
        const start = Math.round(bottom ? local.x : local.y);
        const end = start + Math.round(bottom ? local.width : local.height);
        const cross = Math.round(bottom ? local.y : local.x);
        const crossLength = Math.round(bottom ? local.height : local.width);
        const length = Math.ceil(Math.max(this.rest.areaEnd - this.rest.areaStart, end - start));
        const seam = Math.round((start + end) / 2);
        const margin = Math.ceil(GLASS_SHADOW * this.scaleFactor);
        this._glass.forEach((clip, index) => {
            const from = index ? seam : start - margin;
            const to = index ? end + margin : seam;
            const offset = (index ? end - length : start) - from;
            const glass = clip.get_first_child();
            if (bottom) {
                clip.set_position(from, cross - margin);
                clip.set_size(to - from, crossLength + 2 * margin);
                glass.set_position(offset, margin);
            } else {
                clip.set_position(cross - margin, from);
                clip.set_size(crossLength + 2 * margin, to - from);
                glass.set_position(margin, offset);
            }
            const [width, height] = bottom ? [length, crossLength] : [crossLength, length];
            if (glass.width !== width || glass.height !== height)
                glass.set_size(width, height);
        });
    }

    // Styles take logical px; the focus ring is drawn on the unscaled button.
    _applyRadii() {
        const radii = Layout.radii(this.rest);
        const px = value => value / this.scaleFactor + "px;";
        this._glass.forEach(clip => clip.get_first_child().set_style("border-radius: " + px(radii.dock)));
        this._order.forEach(item => {
            const radius = radii.icon * this.maxIconSize / this.rest.iconSize;
            item.button.set_style("border-radius: " + px(radius));
            item.ring.set_style("border-radius: " + px(radius + item.ringGap));
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
        this._placePill(blend ? this._lerpRect(blend.pill, placed.dock, t) : placed.dock);
        this._setRect(this.hitArea, this._hovering ? this._zone() : placed.dock);

        const icons = placed.items.filter(slot => slot.kind === "icon");
        const separators = placed.items.filter(slot => slot.kind === "separator");
        this._separators.forEach((actor, role) => actor.visible = this._roles.includes(role));
        separators.forEach((slot, index) => {
            const role = this._roles[index];
            const actor = this._separator(role);
            const from = blend && blend.separators.get(role);
            this._setRect(actor, from ? this._lerpRect(from, slot.rect, t) : slot.rect);
            actor.opacity = blend && !from ? Math.round(255 * t) : 255;
        });

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

    _separator(role) {
        if (!this._separators.has(role)) {
            const actor = new St.Widget({ style_class: "tahoe-separator" });
            this.content.insert_child_above(actor, this.pill);
            this._separators.set(role, actor);
        }
        return this._separators.get(role);
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
        // The dragged icon is the copy under the pointer; its slot stays empty.
        const drag = this._drag;
        const dragged = drag && !drag.ended && drag.key === item.key;
        item.button.opacity = dragged ? 0 : Math.round(255 * opacity);
    }

    // The strut covers the whole edge strip, panels included, up to the rest
    // dock's far side plus the same gap the dock keeps from its edge.
    _placeReservation() {
        // Auto-hide leaves the edge to the windows, as with a hidden panel.
        const thickness = this.autohide ? 0 : Math.ceil(this.edgeInset +
            2 * this.tokens["dock.bottomOffset"] + this.rest.crossLength);
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
        this._clearPreviewTimer();
        this._preview.destroy();
        this._items.forEach(item => item.destroy());
        this._items.clear();
        this._leaving.forEach(leaving => leaving.item.destroy());
        this._leaving = [];
        Main.layoutManager.untrackChrome(this.hitArea);
        Main.layoutManager.removeChrome(this.actor);
        Main.layoutManager.removeChrome(this.reservation);
        Main.layoutManager.removeChrome(this.trigger);
        this.actor.destroy();
        this.reservation.destroy();
        this.trigger.destroy();
    }
}
