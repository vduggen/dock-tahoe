// Loads the pure modules of the GNOME Shell build as ES modules, outside the
// shell (scripts/check.sh):
//   gjs -m tests/gnome.js build/gnome/<uuid>
const PURE = ["tokens", "calibration", "tuning", "state", "grouping", "magnification", "animation",
    "badges", "bookmarks", "bubble", "stacks", "layout"];

const dir = ARGV[0];
for (const name of PURE) {
    const module = await import("file://" + dir + "/lib/" + name + ".js");
    if (!Object.keys(module).length)
        throw new Error(name + ".js exports nothing");
}
const Tuning = await import("file://" + dir + "/lib/tuning.js");
const { tokens } = Tuning.tuning({ calibration: false, calibrationValues: {}, iconSize: 48, magnification: true, magnificationSize: 72 });
if (tokens["icon.maxSize"] !== 72)
    throw new Error("tuning: icon.maxSize " + tokens["icon.maxSize"]);
print("GNOME build: " + PURE.length + " pure modules load");
