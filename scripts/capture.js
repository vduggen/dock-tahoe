// Captures the dock for docs/VALIDACAO.md: a screenshot cropped around the
// dock, with the run's environment beside it (<name>.json), as SPEC §10
// asks of reference captures. Asks the running Cinnamon for the dock's
// place through org.Cinnamon.Eval.
//
//   cjs scripts/capture.js <name> [monitor index]
//
// Writes captures/<date>-<name>.png and .json.
imports.gi.versions.GdkPixbuf = "2.0";
const { Gio, GLib, GdkPixbuf } = imports.gi;

const UUID = "dock-tahoe@vduggen";

const [name, monitorArg] = ARGV;
if (!name || !/^[\w.-]+$/.test(name)) {
    printerr("usage: cjs scripts/capture.js <name> [monitor index]");
    imports.system.exit(2);
}
const monitorIndex = Number(monitorArg || 0);

// Runs in Cinnamon: the dock on `monitorIndex`, its glass pill in stage px
// and the settings that change how it looks.
const PROBE = `(() => {
    const views = [];
    const find = actor => {
        if (actor.get_name && actor.get_name() === "tahoe-dock-container")
            views.push(actor._delegate);
        actor.get_children().forEach(find);
    };
    find(global.stage);
    const view = views.find(view => view.monitor.index === ${monitorIndex});
    if (!view)
        return "";
    const [x, y] = view.pill.get_transformed_position();
    const settings = view.actions.settings;
    const monitor = view.monitor;
    return JSON.stringify({
        monitor: { index: monitor.index, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height },
        scale: view.scaleFactor,
        pill: { x: Math.round(x), y: Math.round(y), width: Math.round(view.pill.width), height: Math.round(view.pill.height) },
        maxIconSize: view.maxIconSize,
        settings: {
            position: settings.position, iconSize: settings.iconSize,
            magnification: settings.magnification, magnificationSize: settings.magnificationSize,
            autohide: settings.autohide, glassBlur: settings.glassBlur,
            iconAppearance: settings.iconAppearance, iconTint: settings.iconTint
        }
    });
})()`;

function run(argv) {
    const [ok, out, , status] = GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (!ok || status !== 0)
        throw new Error(argv[0] + " failed");
    return new TextDecoder().decode(out).trim();
}

function probe() {
    const reply = Gio.DBus.session.call_sync("org.Cinnamon", "/org/Cinnamon", "org.Cinnamon", "Eval",
        new GLib.Variant("(s)", [PROBE]), null, Gio.DBusCallFlags.NONE, -1, null);
    const [success, result] = reply.deep_unpack();
    const text = success ? JSON.parse(result) : "";
    if (!text)
        throw new Error(success ? "no dock on monitor " + monitorIndex + " (is " + UUID + " enabled?)" : result);
    return JSON.parse(text);
}

const dock = probe();
const directory = "captures";
GLib.mkdir_with_parents(directory, 0o755);
const stamp = GLib.DateTime.new_now_local().format("%Y%m%d-%H%M%S");
const base = directory + "/" + stamp + "-" + name;
const full = base + "-full.png";
run(["gnome-screenshot", "-f", full]);

// Room for magnified and bouncing icons, kept on the dock's monitor.
const reach = Math.round(dock.maxIconSize * 1.5);
const monitor = dock.monitor;
const left = Math.max(monitor.x, dock.pill.x - reach);
const top = Math.max(monitor.y, dock.pill.y - reach);
const right = Math.min(monitor.x + monitor.width, dock.pill.x + dock.pill.width + reach);
const bottom = Math.min(monitor.y + monitor.height, dock.pill.y + dock.pill.height + reach);
const crop = { x: left, y: top, width: right - left, height: bottom - top };
const screen = GdkPixbuf.Pixbuf.new_from_file(full);
screen.new_subpixbuf(crop.x, crop.y, crop.width, crop.height).savev(base + ".png", "png", [], []);
Gio.File.new_for_path(full).delete(null);

const environment = {
    name: name,
    date: GLib.DateTime.new_now_local().format_iso8601(),
    commit: run(["git", "rev-parse", "--short", "HEAD"]),
    cinnamon: run(["cinnamon", "--version"]),
    session: GLib.getenv("XDG_SESSION_TYPE"),
    monitor: monitor,
    scale: dock.scale,
    settings: dock.settings,
    crop: crop,
    // The glass pill inside the crop, for scripts/compare.js.
    pill: { x: dock.pill.x - crop.x, y: dock.pill.y - crop.y, width: dock.pill.width, height: dock.pill.height }
};
GLib.file_set_contents(base + ".json", JSON.stringify(environment, null, 2) + "\n");
print(base + ".png");
