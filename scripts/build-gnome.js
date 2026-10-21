#!/usr/bin/env node
// Builds the GNOME Shell package of the extension in build/gnome/<uuid>:
//   node scripts/build-gnome.js
//
// lib/ is shared with Cinnamon, which loads it with imports.* and require();
// GNOME Shell 45+ loads ES modules. Each lib/ file is rewritten to imports
// and exports, gnome/lib/ takes the place of the Cinnamon-only modules, and
// the GSettings schema is generated from settings-schema.json.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const GNOME = path.join(ROOT, "gnome");
const SCHEMA_ID = "org.gnome.shell.extensions.dock-tahoe";
const SCHEMA_PATH = "/org/gnome/shell/extensions/dock-tahoe/";

// Keys Cinnamon stores as lists of rows or as objects; gnome/lib/settings.js
// reads them back in the shape lib/settings.js gives.
const KEY_TYPES = {
    "pinned-apps": "as",
    "recent-apps": "as",
    "folders": "as",
    "focus-hotkey": "as",
    "stack-options": "s",
    "calibration": "b"
};
// The Cinnamon default is the author's own dock; GNOME starts from the
// shell's favorites (gnome/lib/settings.js).
const KEY_DEFAULTS = { "pinned-apps": [], "stack-options": "{}" };
const SKIPPED_TYPES = ["section", "header", "separator", "label"];

function fail(message) {
    console.error("build-gnome: " + message);
    process.exit(1);
}

// One lib/ module, from Cinnamon's imports.* and require() to ESM.
function toModule(source, file) {
    const out = source
        .replace(/^const (\w+) = imports\.gi\.(\w+);$/gm, 'import $1 from "gi://$2";')
        .replace(/^const (\w+) = imports\.ui\.(\w+);$/gm,
            'import * as $1 from "resource:///org/gnome/shell/ui/$2.js";')
        .replace(/^const (\w+) = imports\.cairo;$/gm, 'import $1 from "cairo";')
        .replace(/^const (\w+) = require\("\.\/lib\/(\w+\.js)"\);$/gm, 'import * as $1 from "./$2";')
        .replace(/^const (\{[^}]*\}) = require\("\.\/lib\/(\w+\.js)"\);$/gm, 'import $1 from "./$2";')
        .replace(/^(var|let|const|function|class) /gm, "export $1 ");
    const left = out.split("\n").map((line, index) => [line, index + 1])
        .filter(([line]) => /\bimports\.|\brequire\(/.test(line.replace(/\/\/.*$/, "")));
    if (left.length)
        fail(file + ": cannot convert\n" + left.map(([line, n]) => "  " + n + ": " + line).join("\n"));
    return out;
}

function escapeXml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A GVariant text value of `type`.
function variant(type, value) {
    const quote = text => "'" + String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    if (type === "as")
        return value.length ? "[" + value.map(quote).join(", ") + "]" : "@as []";
    if (type === "s")
        return quote(value);
    if (type === "b")
        return value ? "true" : "false";
    return String(Math.round(value));
}

function keyType(key, spec) {
    if (KEY_TYPES[key])
        return KEY_TYPES[key];
    if (spec.type === "switch")
        return "b";
    if (spec.type === "spinbutton")
        return "i";
    if (spec.type === "combobox")
        return typeof spec.default === "number" ? "i" : "s";
    if (spec.type === "colorchooser" || spec.type === "entry")
        return "s";
    fail(key + ": no GSettings type for " + spec.type);
}

function gschema(schema) {
    const keys = Object.keys(schema).filter(key => SKIPPED_TYPES.indexOf(schema[key].type) < 0).map(key => {
        const spec = schema[key];
        const type = keyType(key, spec);
        let value = key in KEY_DEFAULTS ? KEY_DEFAULTS[key] : spec.default;
        if (type === "as" && !Array.isArray(value))
            value = value ? [value] : [];
        const lines = ['    <key name="' + key + '" type="' + type + '">',
            "      <default>" + escapeXml(variant(type, value)) + "</default>"];
        if (spec.type === "spinbutton")
            lines.push('      <range min="' + spec.min + '" max="' + spec.max + '"/>');
        if (spec.description)
            lines.push("      <summary>" + escapeXml(spec.description) + "</summary>");
        if (spec.tooltip)
            lines.push("      <description>" + escapeXml(spec.tooltip) + "</description>");
        lines.push("    </key>");
        return lines.join("\n");
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<schemalist>\n' +
        '  <schema id="' + SCHEMA_ID + '" path="' + SCHEMA_PATH + '">\n' +
        keys.join("\n") + "\n  </schema>\n</schemalist>\n";
}

function main() {
    const cinnamon = JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json"), "utf8"));
    const metadata = Object.assign(JSON.parse(fs.readFileSync(path.join(GNOME, "metadata.json"), "utf8")),
        { "version-name": cinnamon.version });
    const out = path.join(ROOT, "build", "gnome", metadata.uuid);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, "lib"), { recursive: true });
    fs.mkdirSync(path.join(out, "schemas"));

    const replaced = fs.readdirSync(path.join(GNOME, "lib"));
    fs.readdirSync(path.join(ROOT, "lib")).filter(name => name.endsWith(".js")).forEach(name => {
        const target = path.join(out, "lib", name);
        if (replaced.indexOf(name) >= 0)
            fs.copyFileSync(path.join(GNOME, "lib", name), target);
        else
            fs.writeFileSync(target, toModule(fs.readFileSync(path.join(ROOT, "lib", name), "utf8"), "lib/" + name));
    });
    ["extension.js", "prefs.js"].forEach(name => fs.copyFileSync(path.join(GNOME, name), path.join(out, name)));

    fs.writeFileSync(path.join(out, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
    fs.writeFileSync(path.join(out, "stylesheet.css"),
        fs.readFileSync(path.join(ROOT, "stylesheet.css"), "utf8").replace(/\.menu\.tahoe-menu/g, ".popup-menu.tahoe-menu") +
        "\n" + fs.readFileSync(path.join(GNOME, "stylesheet.css"), "utf8"));
    // prefs.js builds its rows from the same description Cinnamon uses.
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "settings-schema.json"), "utf8"));
    fs.copyFileSync(path.join(ROOT, "settings-schema.json"), path.join(out, "settings-schema.json"));
    fs.writeFileSync(path.join(out, "schemas", SCHEMA_ID + ".gschema.xml"), gschema(schema));
    execFileSync("glib-compile-schemas", ["--strict", path.join(out, "schemas")], { stdio: "inherit" });

    console.log(out);
}

main();
