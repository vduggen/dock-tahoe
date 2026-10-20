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

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const St = imports.gi.St;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const Layout = require("./lib/layout.js");
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
                view.actions.activate(this.entry, view.monitor.index);
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

    update(entry) {
        this.entry = entry;
        this.button.accessible_name = entry.name;
        this.indicator.visible = entry.facts.hasWindows;
    }

    destroy() {
        this.button.destroy();
        this.indicator.destroy();
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
        this.logicalTokens = Tokens.resolve();
        this.tokens = Tokens.resolve({}, scaleFactor);
        this.maxIconSize = this.tokens["icon.maxSize"];
        this._items = new Map();
        this._order = [];
        this.rest = null;

        this.actor = new St.Widget({ name: "tahoe-dock-container", reactive: false });
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        this.pill = new St.Widget({ style_class: "tahoe-dock" });
        this.pill.set_style("border-radius: " + this.logicalTokens["dock.cornerRadius"] + "px;");
        this.hitArea = new St.Widget({ reactive: false });
        this.tooltip = new St.Label({ style_class: "tahoe-tooltip", visible: false });
        this._tooltipOwner = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = null;
        this._menuOwner = null;
        this._keyboard = false;
        this._stageEventId = 0;
        this.actor.connect("key-press-event", (actor, event) => this._onKeyPress(event));
        this.actor.add_child(this.pill);
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
        this._items.forEach((item, key) => {
            if (!keys.has(key)) {
                if (item.button.has_key_focus())
                    this.endKeyboard();
                if (this._menuOwner === item)
                    this._destroyMenu();
                item.destroy();
                this._items.delete(key);
            }
        });
        entries.forEach(entry => {
            if (!this._items.has(entry.key))
                this._items.set(entry.key, new DockItem(this, entry));
            this._items.get(entry.key).update(entry);
        });

        this._order = entries.map(entry => this._items.get(entry.key));
        this.rest = Layout.computeRest(this._order.map(() => "icon"), this.tokens,
            this.monitor, this.position, this.edgeInset);
        this._apply(Layout.place(this.rest, null, null));
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
            menu.addAction(windows.length ? "Nova janela" : "Abrir", () => actions.openNewWindow(entry));
        if (entry.desktopFileId)
            menu.addAction(entry.pinned ? "Remover do Dock" : "Manter no Dock", () => actions.togglePin(entry));
        if (windows.length)
            menu.addAction(windows.length > 1 ? "Fechar todas as janelas" : "Fechar",
                () => actions.closeWindows(entry));
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

    _local(rect) {
        return { x: rect.x - this.monitor.x, y: rect.y - this.monitor.y, width: rect.width, height: rect.height };
    }

    _setRect(actor, rect) {
        const local = this._local(rect);
        actor.set_position(Math.round(local.x), Math.round(local.y));
        actor.set_size(Math.round(local.width), Math.round(local.height));
    }

    _apply(placed) {
        this._setRect(this.pill, placed.dock);
        this._setRect(this.hitArea, placed.dock);

        const diameter = placed.items.length ? placed.items[0].indicator.diameter : 0;
        placed.items.forEach((slot, index) => {
            const item = this._order[index];
            const rect = this._local(slot.rect);
            item.button.set_position(rect.x, rect.y);
            item.button.set_scale(slot.size / this.maxIconSize, slot.size / this.maxIconSize);

            const center = slot.indicator.center;
            item.indicator.set_size(Math.round(diameter), Math.round(diameter));
            item.indicator.set_position(
                Math.round(center.x - this.monitor.x - diameter / 2),
                Math.round(center.y - this.monitor.y - diameter / 2));
            item.indicator.set_style("border-radius: " + diameter / 2 / this.scaleFactor + "px;");
        });
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
        this.endKeyboard();
        this._destroyMenu();
        this._items.forEach(item => item.destroy());
        this._items.clear();
        Main.layoutManager.untrackChrome(this.hitArea);
        Main.layoutManager.removeChrome(this.actor);
        Main.layoutManager.removeChrome(this.reservation);
        this.actor.destroy();
        this.reservation.destroy();
    }
}
