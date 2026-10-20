// A folder's stack, open beside its dock icon (SPEC "Pastas e Lixeira"):
// a fan of icons rising from it, a grid or a list, as lib/stacks.js
// decides. Modal while open, so keys reach it: Escape, a click elsewhere or
// on its own icon closes it; arrows and Tab move between items.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Main = imports.ui.main;

const { Bubble } = require("./lib/bubbleActor.js");
const BubbleShape = require("./lib/bubble.js");
const Stacks = require("./lib/stacks.js");

// Logical px. Starting points, not measured Tahoe values.
const FAN_ICON = 48;
const FAN_STEP = 56;
const GRID_ICON = 56;
const LIST_ICON = 20;
// Grids and lists scroll past this share of the monitor's height.
const MAX_HEIGHT = 0.7;
const OPEN_MS = 180;
// .tahoe-stack padding.
const STACK_PADDING = 8;

const KEY_DIRECTIONS = {
    [Clutter.KEY_Up]: Gtk.DirectionType.UP,
    [Clutter.KEY_Down]: Gtk.DirectionType.DOWN,
    [Clutter.KEY_Left]: Gtk.DirectionType.LEFT,
    [Clutter.KEY_Right]: Gtk.DirectionType.RIGHT,
    [Clutter.KEY_Tab]: Gtk.DirectionType.TAB_FORWARD,
    [Clutter.KEY_ISO_Left_Tab]: Gtk.DirectionType.TAB_BACKWARD
};

class StackView {
    // view: the DockView it opens from; onOpen(uri): an item or the folder
    // itself was picked.
    constructor(view, onOpen) {
        this._view = view;
        this._onOpen = onOpen;
        this.owner = null;
        this.actor = null;
        this._bubble = null;
        this._eventId = 0;
        this._modal = false;
        // What the open stack shows, so a refresh with nothing new keeps it.
        this._signature = "";
        this._animate = true;
        // Closed stacks still easing out.
        this._closing = new Set();
    }

    get shown() {
        return Boolean(this.owner);
    }

    // Opens `owner`'s stack; keyboard: focus its first item.
    open(owner, keyboard) {
        this.close(this._animate);
        this.owner = owner;
        this._signature = this._signatureOf(owner.entry);
        this._build(owner.entry);
        this.actor.connect("key-press-event", (actor, event) => this._onKeyPress(event));
        if (!Main.pushModal(this.actor)) {
            this.close(false);
            return;
        }
        this._modal = true;
        this._eventId = global.stage.connect("captured-event", (stage, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const source = event.get_source();
            if (this.actor.contains(source))
                return Clutter.EVENT_PROPAGATE;
            // On its own icon the press only closes it, so the click does
            // not open it again.
            const own = this.owner && this.owner.button.contains(source);
            this.close();
            return own ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        if (keyboard)
            this.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    }

    // Rebuilt in place, without the opening animation, when what the
    // owner's entry shows changed.
    refresh() {
        if (!this.owner || this._signatureOf(this.owner.entry) === this._signature)
            return;
        const focused = this.actor.contains(global.stage.get_key_focus());
        this._animate = false;
        this.open(this.owner, focused);
        this._animate = true;
    }

    _signatureOf(entry) {
        return [entry.name, entry.view, entry.sort].concat(entry.items.map(item => item.uri + " " + item.name)).join("\n");
    }

    // animate: ease out as it opened, unless animations are off.
    close(animate = true) {
        if (this._eventId)
            global.stage.disconnect(this._eventId);
        this._eventId = 0;
        const actor = this.actor;
        const bubble = this._bubble;
        this.actor = null;
        this._bubble = null;
        this.owner = null;
        if (!actor)
            return;
        if (this._modal)
            Main.popModal(actor);
        this._modal = false;
        Main.layoutManager.untrackChrome(actor);
        this._view.stackClosed();
        if (!animate || !Main.animations_enabled) {
            actor.destroy();
            return;
        }
        this._closing.add(actor);
        const done = () => {
            if (this._closing.delete(actor))
                actor.destroy();
        };
        const ease = { duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD, onStopped: done };
        if (!bubble && actor.get_n_children()) {
            // The fan's items fall back into the icon.
            actor.get_children().forEach(item => item.ease(Object.assign({
                translation_x: -item.slot.x,
                translation_y: -item.slot.y,
                opacity: 0
            }, ease)));
        } else {
            actor.ease(Object.assign({ opacity: 0 }, ease));
        }
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        const direction = KEY_DIRECTIONS[symbol];
        if (direction === undefined)
            return Clutter.EVENT_PROPAGATE;
        const focus = global.stage.get_key_focus();
        const from = focus && focus !== this.actor && this.actor.contains(focus) ? focus : null;
        this.actor.navigate_focus(from, from ? direction : Gtk.DirectionType.TAB_FORWARD, false);
        return Clutter.EVENT_STOP;
    }

    _build(entry) {
        const view = Stacks.resolveView(entry.view, entry.items.length, this._view.position);
        if (view === "fan")
            this._buildFan(entry);
        else
            this._buildBubble(entry, view);
        Main.layoutManager.trackChrome(this.actor, { affectsInputRegion: true });
    }

    _pick(uri) {
        this.close();
        this._onOpen(uri);
    }

    _button(styleClass, child, uri, name) {
        const button = new St.Button({ style_class: styleClass, can_focus: true, track_hover: true, child: child });
        button.accessible_name = name;
        button.connect("clicked", () => this._pick(uri));
        return button;
    }

    _label(text, styleClass) {
        const label = new St.Label({ text: text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        return label;
    }

    // The way out to the file manager, last in every view.
    _openLabel(entry) {
        const manager = Gio.AppInfo.get_default_for_type("inode/directory", false);
        return manager ? "Abrir em " + manager.get_name() : "Abrir " + entry.name;
    }

    // Icons rising from the dock icon, each with its name on a pill to its
    // left, nearest first; the folder itself caps the fan.
    _buildFan(entry) {
        const scale = this._view.scaleFactor;
        const shown = entry.items.slice(0, Stacks.FAN_MAX - 1);
        const rows = shown.map(item => ({ uri: item.uri, name: item.name, gicon: item.gicon }));
        rows.push({ uri: entry.uri, name: this._openLabel(entry), gicon: entry.gicon, folder: true });
        const slots = Stacks.fanSlots(rows.length, FAN_STEP * scale);

        const button = this._view.ownerRect(this.owner);
        const originX = button.x + button.size / 2;
        const originY = button.y;
        this.actor = new St.Widget({ reactive: false });
        this._view.actor.add_child(this.actor);
        const animate = this._animate && Main.animations_enabled;
        rows.forEach((row, index) => {
            const box = new St.BoxLayout({ style_class: "tahoe-stack-fan-item" });
            // A box, not an St.Bin: Cinnamon's St.Bin aligns with St.Align.
            const label = new St.BoxLayout({
                style_class: "tahoe-stack-fan-label" + (row.folder ? " folder" : ""),
                y_align: Clutter.ActorAlign.CENTER
            });
            label.add_child(this._label(row.name, "tahoe-stack-fan-text"));
            box.add_child(label);
            box.add_child(new St.Icon({ gicon: row.gicon, icon_size: FAN_ICON }));
            const item = this._button("tahoe-stack-fan-button", box, row.uri, row.name);
            this.actor.add_child(item);
            const [, width] = item.get_preferred_width(-1);
            const [, height] = item.get_preferred_height(width);
            const iconCenter = width - FAN_ICON * scale / 2;
            const slot = slots[index];
            // Where close() sends it back from.
            item.slot = slot;
            item.set_position(Math.round(originX + slot.x - iconCenter), Math.round(originY + slot.y - height / 2));
            if (animate) {
                item.translation_x = -slot.x;
                item.translation_y = -slot.y;
                item.opacity = 0;
                item.ease({
                    translation_x: 0,
                    translation_y: 0,
                    opacity: 255,
                    duration: OPEN_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            }
        });
    }

    // A bubble beside the icon, as the previews: the folder's name, its
    // items as a grid of icons or a list of rows, and the way out.
    _buildBubble(entry, view) {
        const scale = this._view.scaleFactor;
        this.actor = new St.BoxLayout({ style_class: "tahoe-stack tahoe-stack-" + view, vertical: true, reactive: true });
        this._bubble = new Bubble(this.actor, BubbleShape.ARROW_SIDES[this._view.position], this._view.tokens);
        this.actor.set_style(this._bubble.padding(scale, STACK_PADDING));
        if (view === "grid")
            this.actor.add_child(this._label(entry.name, "tahoe-stack-title"));

        let content;
        if (view === "grid") {
            const layout = new Clutter.GridLayout({ column_homogeneous: true, row_homogeneous: true });
            // St.ScrollView takes only scrollable children, as St.BoxLayout.
            content = new St.BoxLayout({ vertical: true });
            content.add_child(new St.Widget({ layout_manager: layout }));
            const columns = Stacks.gridShape(entry.items.length).columns;
            entry.items.forEach((item, index) => {
                const cell = new St.BoxLayout({ vertical: true });
                cell.add_child(new St.Icon({ gicon: item.gicon, icon_size: GRID_ICON, x_align: Clutter.ActorAlign.CENTER }));
                const label = this._label(item.name, "tahoe-stack-cell-label");
                label.x_align = Clutter.ActorAlign.CENTER;
                cell.add_child(label);
                layout.attach(this._button("tahoe-stack-cell", cell, item.uri, item.name),
                    index % columns, Math.floor(index / columns), 1, 1);
            });
        } else {
            content = new St.BoxLayout({ vertical: true });
            entry.items.forEach(item => {
                const row = new St.BoxLayout({ style_class: "tahoe-stack-row-box" });
                row.add_child(new St.Icon({ gicon: item.gicon, icon_size: LIST_ICON }));
                row.add_child(this._label(item.name, "tahoe-stack-row-label"));
                const button = this._button("tahoe-stack-row", row, item.uri, item.name);
                // Cinnamon's St.Bin: rows start at the left edge.
                button.x_fill = true;
                content.add_child(button);
            });
        }
        if (!entry.items.length) {
            content = new St.BoxLayout();
            content.add_child(this._label("Pasta vazia", "tahoe-stack-empty"));
        }

        const scroll = new St.ScrollView({
            style_class: "tahoe-stack-scroll",
            hscrollbar_policy: St.PolicyType.NEVER
        });
        scroll.add_actor(content);
        this.actor.add_child(scroll);
        this.actor.add_child(this._button("tahoe-stack-open", this._label(this._openLabel(entry), "tahoe-stack-open-label"),
            entry.uri, this._openLabel(entry)));

        this._view.actor.add_child(this.actor);
        // A scroll view asks for no height of its own: the content's, styled
        // now that it is on the stage, up to MAX_HEIGHT. Its scrollbar takes
        // width from the content, so it is there only when it scrolls.
        const [, width] = content.get_preferred_width(-1);
        const [, height] = content.get_preferred_height(width);
        const maxHeight = Math.round(MAX_HEIGHT * this._view.monitor.height);
        const scrolls = height > maxHeight;
        scroll.vscrollbar_policy = scrolls ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
        scroll.set_size(width + (scrolls ? scroll.vscroll.get_preferred_width(-1)[1] : 0), Math.min(height, maxHeight));
        this._view.placeBeside(this.actor, this._bubble, this.owner);
        if (this._animate && Main.animations_enabled) {
            this.actor.opacity = 0;
            this.actor.ease({ opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    destroy() {
        this.close(false);
        this._closing.forEach(actor => actor.destroy());
        this._closing.clear();
    }
}
