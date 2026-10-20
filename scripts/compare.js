// Compares a capture (scripts/capture.js) with a Tahoe reference, for the
// geometry and appearance criteria of docs/VALIDACAO.md. Both images are
// brought to logical px and aligned on the glass pill: centered along the
// dock, flush at its outer edge. Writes <capture>-overlay.png (the capture
// at half opacity over the reference) and <capture>-diff.png (per-pixel
// difference, brighter is farther), and prints the pill's size difference
// and the mean pixel difference.
//
//   cjs scripts/compare.js <capture.png> <reference.png> <x,y,width,height> [reference scale]
//
// x,y,width,height: the pill in the reference, in its px, as measured in an
// image editor. The capture's pill and scale come from its .json.
imports.gi.versions.GdkPixbuf = "2.0";
const { GLib, GdkPixbuf } = imports.gi;

const [capturePath, referencePath, pillArg, scaleArg] = ARGV;
const referencePill = (pillArg || "").split(",").map(Number);
if (!capturePath || !referencePath || referencePill.length !== 4 || referencePill.some(isNaN)) {
    printerr("usage: cjs scripts/compare.js <capture.png> <reference.png> <x,y,width,height> [reference scale]");
    imports.system.exit(2);
}

const [, bytes] = GLib.file_get_contents(capturePath.replace(/\.png$/, ".json"));
const environment = JSON.parse(new TextDecoder().decode(bytes));
const position = environment.settings.position;

// An image scaled to logical px, with its pill in the same units.
function logical(path, pill, scale) {
    const source = GdkPixbuf.Pixbuf.new_from_file(path).add_alpha(false, 0, 0, 0);
    const width = Math.round(source.width / scale);
    const height = Math.round(source.height / scale);
    return {
        image: scale === 1 ? source : source.scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR),
        pill: { x: pill.x / scale, y: pill.y / scale, width: pill.width / scale, height: pill.height / scale }
    };
}

const capture = logical(capturePath, environment.pill, environment.scale);
const [x, y, width, height] = referencePill;
const reference = logical(referencePath, { x: x, y: y, width: width, height: height }, Number(scaleArg || 1));

// Where each image's origin goes so that the pills line up: centered along
// the dock, flush at the edge of the screen it sits on.
function anchor(pill) {
    if (position === "bottom")
        return { x: pill.x + pill.width / 2, y: pill.y + pill.height };
    return { x: position === "left" ? pill.x : pill.x + pill.width, y: pill.y + pill.height / 2 };
}
const a = anchor(capture.pill);
const b = anchor(reference.pill);
const offsets = [{ x: 0, y: 0 }, { x: Math.round(a.x - b.x), y: Math.round(a.y - b.y) }];
const images = [capture.image, reference.image];
const left = Math.min(...offsets.map(offset => offset.x));
const top = Math.min(...offsets.map(offset => offset.y));
const canvasWidth = Math.max(...images.map((image, index) => offsets[index].x + image.width)) - left;
const canvasHeight = Math.max(...images.map((image, index) => offsets[index].y + image.height)) - top;

function placed(index) {
    const canvas = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, canvasWidth, canvasHeight);
    canvas.fill(0);
    images[index].copy_area(0, 0, images[index].width, images[index].height,
        canvas, offsets[index].x - left, offsets[index].y - top);
    return canvas;
}

const base = capturePath.replace(/\.png$/, "");
const overlay = placed(1);
images[0].composite(overlay, offsets[0].x - left, offsets[0].y - top, images[0].width, images[0].height,
    offsets[0].x - left, offsets[0].y - top, 1, 1, GdkPixbuf.InterpType.NEAREST, 128);
overlay.savev(base + "-overlay.png", "png", [], []);

// Difference where both images have pixels; transparent elsewhere.
const [mine, theirs] = [placed(0), placed(1)];
const p = mine.get_pixels();
const q = theirs.get_pixels();
const stride = mine.rowstride;
const diff = new Uint8Array(stride * canvasHeight);
let total = 0;
let count = 0;
for (let row = 0; row < canvasHeight; row++) {
    for (let column = 0; column < canvasWidth; column++) {
        const i = row * stride + column * 4;
        if (!p[i + 3] || !q[i + 3])
            continue;
        const delta = (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])) / 3;
        total += delta;
        count++;
        diff[i] = diff[i + 1] = diff[i + 2] = Math.min(255, delta * 4);
        diff[i + 3] = 255;
    }
}
GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(diff), GdkPixbuf.Colorspace.RGB, true, 8,
    canvasWidth, canvasHeight, stride).savev(base + "-diff.png", "png", [], []);

const along = position === "bottom" ? "width" : "height";
const across = position === "bottom" ? "height" : "width";
const delta = key => (capture.pill[key] - reference.pill[key]).toFixed(1);
print("pill " + along + " (along the dock): " + delta(along) + " logical px");
print("pill " + across + " (across the dock): " + delta(across) + " logical px");
print("mean pixel difference: " + (count ? (total / count).toFixed(1) : "n/a") + " / 255");
print(base + "-overlay.png");
print(base + "-diff.png");
