// Window previews of one dock item: a bubble beyond its icon with a card per
// window, a live thumbnail (Clutter.Clone of the window actor) and a close
// button. The view decides when it shows (hover intent) and where; this file
// only builds and refreshes the cards.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Main = imports.ui.main;

const { Bubble } = require("./lib/bubbleActor.js");
const BubbleShape = require("./lib/bubble.js");
const Layout = require("./lib/layout.js");

// Logical px. Starting points, not measured Tahoe values.
const THUMBNAIL_WIDTH = 200;
const THUMBNAIL_HEIGHT = 125;
// .tahoe-preview padding and spacing, and .tahoe-preview-card padding.
const PREVIEW_PADDING = 8;
const PREVIEW_SPACING = 6;
const CARD_PADDING = 6;
// .tahoe-preview-card border, transparent until the card is the active one.
const CARD_BORDER = 2;
const CLOSE_ICON_SIZE = 10;
const FADE_MS = 120;
// Hovering a card this long focuses its window, so sweeping across the
// cards does not flip through every window.
const FOCUS_DELAY_MS = 150;

class WindowPreview {
    // onActivate(metaWindow) runs when a card is clicked, onFocus(metaWindow)
    // when one is hovered.
    constructor(parent, monitor, position, scaleFactor, tokens, onActivate, onFocus) {
        this.monitor = monitor;
        this.position = position;
        this.scaleFactor = scaleFactor;
        this._onActivate = onActivate;
        this._onFocus = onFocus;
        this.owner = null;
        this._windows = [];
        this.actor = new St.BoxLayout({
            style_class: "tahoe-preview",
            vertical: position !== "bottom",
            reactive: true,
            track_hover: true,
            visible: false
        });
        this.bubble = new Bubble(this.actor, BubbleShape.ARROW_SIDES[position], tokens);
        this.actor.set_style(this.bubble.padding(scaleFactor, PREVIEW_PADDING));
        parent.add_child(this.actor);
        Main.layoutManager.trackChrome(this.actor, { affectsInputRegion: true });
    }

    get shown() {
        return this.actor.visible;
    }

    // Shows `owner`'s windows, fading in unless already shown.
    show(owner) {
        const wasShown = this.shown && this.owner;
        this.owner = owner;
        this.refresh();
        if (!this._windows.length)
            return;
        if (wasShown)
            return;
        this.actor.remove_all_transitions();
        this.actor.set_opacity(0);
        this.actor.show();
        this.actor.ease({ opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    // Rebuilds the cards when the owner's windows changed; hides with none.
    refresh() {
        if (!this.owner)
            return;
        const entry = this.owner.entry;
        // This monitor's windows only, as its dock's dots show.
        const windows = entry.windows.filter(window => window.monitor === this.monitor.index)
            .map(window => window.metaWindow).filter(Boolean);
        if (!windows.length) {
            this.hide();
            return;
        }
        const same = windows.length === this._windows.length &&
            windows.every((window, index) => window === this._windows[index]);
        if (same) {
            this._syncActive();
            return;
        }
        this._windows = windows;
        this.actor.destroy_all_children();
        const scale = this.scaleFactor;
        const vertical = this.position !== "bottom";
        const available = 0.9 * (vertical ? this.monitor.height : this.monitor.width) - 2 * PREVIEW_PADDING * scale;
        const box = Layout.previewBox(windows.length, THUMBNAIL_WIDTH * scale, THUMBNAIL_HEIGHT * scale,
            available, (2 * (CARD_PADDING + CARD_BORDER) + PREVIEW_SPACING) * scale, vertical);
        windows.forEach(window => this.actor.add_child(this._card(window, entry.name, box)));
        this._syncActive();
    }

    // The focused window's card is marked, as the dock marks the focused app.
    _syncActive() {
        const focused = global.display.get_focus_window();
        this.actor.get_children().forEach((card, index) => {
            if (this._windows[index] === focused)
                card.add_style_class_name("active");
            else
                card.remove_style_class_name("active");
        });
    }

    hide() {
        this.owner = null;
        this._windows = [];
        this.actor.remove_all_transitions();
        this.actor.hide();
        this.actor.destroy_all_children();
    }

    _card(window, fallbackTitle, box) {
        const title = new St.Label({
            style_class: "tahoe-preview-title",
            text: window.get_title() || fallbackTitle,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const close = new St.Button({
            style_class: "tahoe-preview-close",
            can_focus: true,
            child: new St.Icon({ icon_name: "window-close-symbolic", icon_size: CLOSE_ICON_SIZE })
        });
        close.accessible_name = "Fechar " + title.text;
        close.connect("clicked", () => window.delete(global.get_current_time()));
        const header = new St.BoxLayout({ style_class: "tahoe-preview-header" });
        header.set_width(box.width);
        header.add_child(title);
        header.add_child(close);

        const thumbnail = new St.Widget({ width: box.width, height: box.height });
        const source = window.get_compositor_private();
        if (source) {
            const clone = new Clutter.Clone({ source: source });
            const fitted = Layout.fitThumbnail(source.width, source.height, box.width, box.height);
            clone.set_position(fitted.x, fitted.y);
            clone.set_size(fitted.width, fitted.height);
            thumbnail.add_child(clone);
        }

        const content = new St.BoxLayout({ vertical: true });
        content.add_child(header);
        content.add_child(thumbnail);
        const card = new St.Button({
            style_class: "tahoe-preview-card",
            can_focus: true,
            track_hover: true,
            child: content
        });
        card.accessible_name = title.text;
        card.connect("clicked", () => this._onActivate(window));
        const titleId = window.connect("notify::title", () => {
            title.text = window.get_title() || fallbackTitle;
            card.accessible_name = title.text;
            close.accessible_name = "Fechar " + title.text;
        });
        let focusId = 0;
        const cancelFocus = () => {
            if (focusId)
                GLib.source_remove(focusId);
            focusId = 0;
        };
        card.connect("notify::hover", () => {
            cancelFocus();
            if (card.hover)
                focusId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FOCUS_DELAY_MS, () => {
                    focusId = 0;
                    this._onFocus(window);
                    return GLib.SOURCE_REMOVE;
                });
        });
        card.connect("destroy", () => {
            cancelFocus();
            window.disconnect(titleId);
        });
        return card;
    }

    destroy() {
        this.hide();
        Main.layoutManager.untrackChrome(this.actor);
        this.actor.destroy();
    }
}
