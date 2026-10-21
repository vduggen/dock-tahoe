// Tahoe Dock — settings window on GNOME. Its rows come from
// settings-schema.json, the description Cinnamon builds its own window from,
// so both list the same settings in the same order; the values live in
// GSettings (scripts/build-gnome.js).

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Kept by the dock itself, never shown.
const HIDDEN_TYPES = ["generic"];

export default class TahoeDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const [, contents] = this.dir.get_child("settings-schema.json").load_contents(null);
        const schema = JSON.parse(new TextDecoder().decode(contents));
        // Rows whose sensitivity, or groups whose visibility, follow other keys.
        const dependents = [];
        const page = new Adw.PreferencesPage({ title: "Tahoe Dock", icon_name: "preferences-desktop-apps-symbolic" });
        let group = new Adw.PreferencesGroup();
        page.add(group);

        Object.keys(schema).forEach(key => {
            const spec = schema[key];
            if (spec.type === "section") {
                group = new Adw.PreferencesGroup({ title: spec.description || "" });
                page.add(group);
                if (spec.dependency)
                    dependents.push([group, "visible", spec.dependency]);
                return;
            }
            if (HIDDEN_TYPES.indexOf(spec.type) >= 0)
                return;
            if (spec.type === "list") {
                // A list is a group of its own, after the current one.
                const list = folderGroup(window, settings, key, spec);
                page.add(list);
                group = new Adw.PreferencesGroup();
                page.add(group);
                return;
            }
            const row = createRow(window, settings, key, spec);
            if (!row)
                return;
            group.add(row);
            if (spec.dependency)
                dependents.push([row, "sensitive", spec.dependency]);
        });

        dependents.forEach(([widget, property, dependency]) => {
            const update = () => widget[property] = dependencyMet(settings, dependency);
            settings.connect("changed::" + dependency.replace(/^!/, "").split("=")[0], update);
            update();
        });
        window.add(page);
        window.set_default_size(620, 760);
    }
}

// "key", "!key" or "key=value", as Cinnamon's settings-schema.json writes it.
function dependencyMet(settings, dependency) {
    const negate = dependency.startsWith("!");
    const [key, expected] = dependency.replace(/^!/, "").split("=");
    const value = settings.get_value(key).recursiveUnpack();
    const met = expected === undefined ? Boolean(value) : String(value) === expected;
    return negate ? !met : met;
}

function subtitle(spec) {
    return [spec.tooltip, spec.units].filter(Boolean).join(" · ");
}

function createRow(window, settings, key, spec) {
    const title = spec.description || key;
    switch (spec.type) {
    case "switch": {
        const row = new Adw.SwitchRow({ title: title, subtitle: subtitle(spec) });
        settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
    case "spinbutton": {
        const row = Adw.SpinRow.new_with_range(spec.min, spec.max, spec.step || 1);
        row.set_title(title);
        row.set_subtitle(subtitle(spec));
        row.value = settings.get_int(key);
        row.connect("notify::value", () => {
            if (settings.get_int(key) !== Math.round(row.value))
                settings.set_int(key, Math.round(row.value));
        });
        settings.connect("changed::" + key, () => row.value = settings.get_int(key));
        return row;
    }
    case "combobox": {
        const labels = Object.keys(spec.options);
        const values = labels.map(label => spec.options[label]);
        const numeric = typeof spec.default === "number";
        const row = new Adw.ComboRow({ title: title, subtitle: subtitle(spec), model: Gtk.StringList.new(labels) });
        const read = () => numeric ? settings.get_int(key) : settings.get_string(key);
        const select = () => row.selected = Math.max(0, values.indexOf(read()));
        select();
        row.connect("notify::selected", () => {
            const value = values[row.selected];
            if (value === undefined || value === read())
                return;
            if (numeric)
                settings.set_int(key, value);
            else
                settings.set_string(key, value);
        });
        settings.connect("changed::" + key, select);
        return row;
    }
    case "colorchooser": {
        const row = new Adw.ActionRow({ title: title, subtitle: subtitle(spec) });
        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({ with_alpha: false }),
            valign: Gtk.Align.CENTER
        });
        const load = () => {
            const color = button.rgba.copy();
            if (color.parse(settings.get_string(key)))
                button.rgba = color;
        };
        load();
        button.connect("notify::rgba", () => {
            const value = button.rgba.to_string();
            if (value !== settings.get_string(key))
                settings.set_string(key, value);
        });
        settings.connect("changed::" + key, load);
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }
    case "keybinding": {
        // An accelerator as GTK writes it, such as <Super><Alt>d; empty
        // turns the shortcut off.
        const row = new Adw.EntryRow({ title: title, show_apply_button: true });
        row.text = settings.get_strv(key)[0] || "";
        row.connect("apply", () => {
            const text = row.text.trim();
            const [valid] = text ? Gtk.accelerator_parse(text) : [true];
            if (!valid) {
                row.add_css_class("error");
                return;
            }
            row.remove_css_class("error");
            settings.set_strv(key, text ? [text] : []);
        });
        return row;
    }
    default:
        console.warn("Tahoe Dock: no row for " + key + " (" + spec.type + ")");
        return null;
    }
}

// The folders stacked on the dock, one row each, in order.
function folderGroup(window, settings, key, spec) {
    const group = new Adw.PreferencesGroup({ title: spec.description || key, description: spec.tooltip || "" });
    const add = new Gtk.Button({ icon_name: "list-add-symbolic", valign: Gtk.Align.CENTER, tooltip_text: "Adicionar pasta" });
    add.add_css_class("flat");
    group.set_header_suffix(add);
    let rows = [];

    const fill = () => {
        rows.forEach(row => group.remove(row));
        rows = settings.get_strv(key).map((uri, index) => {
            const file = Gio.File.new_for_uri(uri);
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(file.get_basename() || uri, -1),
                subtitle: GLib.markup_escape_text(file.get_path() || uri, -1)
            });
            const remove = new Gtk.Button({ icon_name: "user-trash-symbolic", valign: Gtk.Align.CENTER, tooltip_text: "Remover" });
            remove.add_css_class("flat");
            remove.connect("clicked", () => {
                const uris = settings.get_strv(key);
                uris.splice(index, 1);
                settings.set_strv(key, uris);
            });
            row.add_suffix(remove);
            group.add(row);
            return row;
        });
    };

    add.connect("clicked", () => {
        new Gtk.FileDialog({ title: "Escolha uma pasta", modal: true }).select_folder(window, null, (dialog, result) => {
            let folder;
            try {
                folder = dialog.select_folder_finish(result);
            } catch (e) {
                return;
            }
            const uris = settings.get_strv(key);
            if (folder && uris.indexOf(folder.get_uri()) < 0)
                settings.set_strv(key, uris.concat([folder.get_uri()]));
        });
    });
    settings.connect("changed::" + key, fill);
    fill();
    return group;
}
