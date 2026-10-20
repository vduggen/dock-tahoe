// Listens for com.canonical.Unity.LauncherEntry Update signals on the session
// bus and keeps each app's badge state (lib/badges.js). An app's badges go
// away when its bus connection does, as in Dash to Dock.

const Gio = imports.gi.Gio;

const Badges = require("./lib/badges.js");

class LauncherEntry {
    // onChange(): called whenever a badge changes.
    constructor(onChange) {
        this._onChange = onChange;
        // desktop id → { count, visible, sender }
        this._states = new Map();
        this._subscriptions = [];
    }

    enable() {
        const bus = Gio.DBus.session;
        this._subscriptions = [
            bus.signal_subscribe(null, "com.canonical.Unity.LauncherEntry", "Update", null, null,
                Gio.DBusSignalFlags.NONE, (connection, sender, path, iface, signal, parameters) =>
                    this._update(sender, parameters)),
            bus.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged",
                "/org/freedesktop/DBus", null, Gio.DBusSignalFlags.NONE,
                (connection, sender, path, iface, signal, parameters) => {
                    const [name, , owner] = parameters.deep_unpack();
                    if (!owner)
                        this._forget(name);
                })
        ];
    }

    disable() {
        this._subscriptions.forEach(id => Gio.DBus.session.signal_unsubscribe(id));
        this._subscriptions = [];
        this._states.clear();
    }

    // The badge text for a normalized desktop id, or null.
    label(desktopId) {
        return Badges.label(this._states.get(desktopId));
    }

    _update(sender, parameters) {
        let uri, properties;
        try {
            [uri, properties] = parameters.recursiveUnpack();
        } catch (e) {
            return;
        }
        const id = Badges.desktopId(uri);
        if (!id || !properties)
            return;
        const before = this.label(id);
        const state = Badges.merge(this._states.get(id), properties);
        state.sender = sender;
        this._states.set(id, state);
        if (this.label(id) !== before)
            this._onChange();
    }

    _forget(sender) {
        let changed = false;
        this._states.forEach((state, id) => {
            if (state.sender !== sender)
                return;
            changed = changed || Badges.label(state) !== null;
            this._states.delete(id);
        });
        if (changed)
            this._onChange();
    }
}

