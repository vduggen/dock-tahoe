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

const St = imports.gi.St;
const Main = imports.ui.main;

const Layout = require("./lib/layout.js");
const Tokens = require("./lib/tokens.js");

const ICON_FALLBACK = "application-x-executable";

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
            track_hover: true
        });
        this.button.set_size(view.maxIconSize, view.maxIconSize);
        this.button.set_child(this._createIcon(entry, view.maxIconSize / view.scaleFactor));
        this.button.accessible_name = entry.name;

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
    constructor(monitor, position, scaleFactor, edgeInset) {
        this.monitor = monitor;
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
        this.actor.add_child(this.pill);
        this.actor.add_child(this.hitArea);

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
    // dock's far side.
    _placeReservation() {
        const thickness = Math.ceil(this.edgeInset + this.tokens["dock.bottomOffset"] +
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
        this._items.forEach(item => item.destroy());
        this._items.clear();
        Main.layoutManager.untrackChrome(this.hitArea);
        Main.layoutManager.removeChrome(this.actor);
        Main.layoutManager.removeChrome(this.reservation);
        this.actor.destroy();
        this.reservation.destroy();
    }
}
