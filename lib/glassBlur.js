// Liquid Glass backdrop (SPEC §3, experimental): the wallpaper behind the
// dock, blurred on the GPU. A Clutter.Clone of the background, so no pixel
// is read back as St's background-blur does; a fragment shader blurs it and
// cuts it to the dock's rounded rect. See PLAN.md, stage 6.
//
// The actor keeps one size, a strip across the whole monitor: resizing an
// effect's actor reallocates its offscreen texture, which dropped
// magnification to ~36 FPS.
//
// Two qualities (the glass-quality setting):
// - fast, for weaker GPUs: the wallpaper only, since global.window_group
//   paints nothing in a clone. The blur hides while a window is behind the
//   dock and the plain glass shows instead.
// - high: each window that crosses the strip is cloned on top of the
//   wallpaper, in stacking order, so the glass blurs windows too and never
//   hides, and each pass takes twice the samples. The strip is redrawn
//   whenever one of those windows is, which costs more GPU.
//
// The blur takes two passes, across then along, by two nested actors with an
// effect each: 2 x 17 samples a pixel instead of 17 x 17, which this
// machine's GPU could not draw at 60 FPS.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Platform = require("./lib/platform.js");

// Samples on each side of a pass, by quality, and how often windows are
// checked.
const TAPS = { fast: 8, high: 16 };
const WINDOW_CHECK_MS = 250;

// One pass along (dx, dy). rect: the dock in strip px, grown by `grow` so the
// first pass covers what the second samples; reach: the kernel's half width
// in px, about two standard deviations. Premultiplied in and out.
//
// The last pass (finish = 1) also draws the rest of the material (SPEC §3):
// refraction, the backdrop bent inwards within `band` px of the edge; tint,
// lifting dark backdrops and dimming bright ones so the icons stay legible;
// a contour that contrasts with the backdrop; and a specular sheen on the
// edges facing the light, from the top.
const shader = taps => `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float x0;
uniform float y0;
uniform float x1;
uniform float y1;
uniform float radius;
uniform float reach;
uniform float dx;
uniform float dy;
uniform float grow;
uniform float finish;
uniform float band;

void main() {
    vec2 size = vec2(width, height);
    vec2 p = cogl_tex_coord_in[0].xy * size;
    vec2 extent = vec2(x1 - x0, y1 - y0) * 0.5 + grow;
    vec2 v = p - vec2(x0 + x1, y0 + y1) * 0.5;
    vec2 q = abs(v) - extent + radius;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float alpha = clamp(0.5 - d, 0.0, 1.0);
    if (alpha <= 0.0) {
        cogl_color_out = vec4(0.0);
        return;
    }
    // Outward normal of the rounded rect.
    vec2 normal = max(q.x, q.y) > 0.0
        ? normalize(max(q, 0.0)) * sign(v)
        : (q.x > q.y ? vec2(sign(v.x), 0.0) : vec2(0.0, sign(v.y)));
    float depth = max(-d, 0.0);
    float edge = finish * clamp(1.0 - depth / band, 0.0, 1.0);
    p -= normal * band * edge * edge;

    float spacing = reach / ${taps}.0;
    float spread = 2.0 * (reach * 0.5) * (reach * 0.5) + 0.0001;
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = -${taps}; i <= ${taps}; i++) {
        float offset = float(i) * spacing;
        float weight = exp(-offset * offset / spread);
        sum += texture2D(tex, (p + vec2(dx, dy) * offset) / size) * weight;
        total += weight;
    }
    vec4 color = sum / total;
    if (finish > 0.5) {
        vec3 rgb = color.rgb;
        float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        rgb = clamp(mix(vec3(luma), rgb, 1.15), 0.0, 1.0);
        rgb = mix(rgb, vec3(1.0), 0.12 * (1.0 - luma)) * (1.0 - 0.1 * luma);
        float rim = 1.0 - smoothstep(0.0, band * 0.2 + 1.0, depth);
        rgb = mix(rgb, vec3(luma > 0.6 ? 0.0 : 1.0), rim * mix(0.3, 0.12, luma));
        float facing = max(dot(normal, normalize(vec2(-0.35, -1.0))), 0.0);
        rgb += vec3(0.35) * pow(facing, 3.0) * edge * edge;
        color = vec4(clamp(rgb, 0.0, 1.0) * color.a, color.a);
    }
    cogl_color_out = color * alpha * cogl_color_in.a;
}`;

function floatValue(value) {
    const gvalue = new GObject.Value();
    gvalue.init(GObject.TYPE_FLOAT);
    gvalue.set_float(value);
    return gvalue;
}

class GlassBlur {
    // parent: the actor it is drawn in, below `sibling`; origin: parent's
    // stage position; reach: blur half width in px; refraction: width of
    // the bent band along the edge, in px; high: the high quality.
    constructor(parent, sibling, origin, horizontal, reach, refraction, high) {
        this._origin = origin;
        this._high = Boolean(high);
        this._shader = shader(TAPS[this._high ? "high" : "fast"]);
        this._horizontal = horizontal;
        this._reach = Math.round(reach);
        this._refraction = Math.max(1, refraction);
        this._dock = null;
        // Second pass, along the dock's cross axis, and first pass inside it.
        this.actor = new St.Widget({ clip_to_allocation: true, reactive: false });
        // Clipped, or its effect would draw the whole cloned background.
        this._inner = new St.Widget({ clip_to_allocation: true, reactive: false });
        this._clone = new Clutter.Clone({ source: Platform.backgroundActor() });
        this._inner.add_child(this._clone);
        // High quality: window clones, laid out in stage coordinates.
        this._windows = new Clutter.Actor();
        this._windowClones = [];
        this._windowSources = [];
        this._inner.add_child(this._windows);
        this.actor.add_child(this._inner);
        this._effects = [this._pass(this._inner, horizontal ? [1, 0] : [0, 1], this._reach, false),
            this._pass(this.actor, horizontal ? [0, 1] : [1, 0], 0, true)];
        parent.insert_child_below(this.actor, sibling);
        this._signals = [];
        if (this._high)
            this._signals = [[global.display, global.display.connect("restacked", () => this._checkWindows())],
                [global.workspace_manager, global.workspace_manager.connect("active-workspace-changed",
                    () => this._checkWindows())]];
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_CHECK_MS, () => {
            this._checkWindows();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pass(actor, direction, grow, finish) {
        const effect = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        effect.set_shader_source(this._shader);
        const sampler = new GObject.Value();
        sampler.init(GObject.TYPE_INT);
        sampler.set_int(0);
        effect.set_uniform_value("tex", sampler);
        effect.set_uniform_value("reach", floatValue(this._reach));
        effect.set_uniform_value("dx", floatValue(direction[0]));
        effect.set_uniform_value("dy", floatValue(direction[1]));
        effect.set_uniform_value("grow", floatValue(grow));
        effect.set_uniform_value("finish", floatValue(finish ? 1 : 0));
        effect.set_uniform_value("band", floatValue(this._refraction));
        actor.add_effect(effect);
        return effect;
    }

    _uniform(name, value) {
        this._effects.forEach(effect => effect.set_uniform_value(name, floatValue(value)));
    }

    // rect: the dock in parent coordinates, rounded; length: the parent's
    // length along the dock.
    place(rect, radius, length) {
        const reach = this._reach;
        // The strip runs the whole length and reaches past the dock across
        // it, so the kernel samples wallpaper, not the strip's edge.
        const strip = this._horizontal
            ? { x: 0, y: rect.y - reach, width: length, height: rect.height + 2 * reach }
            : { x: rect.x - reach, y: 0, width: rect.width + 2 * reach, height: length };
        if (this.actor.width !== strip.width || this.actor.height !== strip.height) {
            this.actor.set_size(strip.width, strip.height);
            this._inner.set_size(strip.width, strip.height);
            this._uniform("width", strip.width);
            this._uniform("height", strip.height);
        }
        this.actor.set_position(strip.x, strip.y);
        this._clone.set_position(-this._origin.x - strip.x, -this._origin.y - strip.y);
        this._windows.set_position(-this._origin.x - strip.x, -this._origin.y - strip.y);
        const local = [rect.x - strip.x, rect.y - strip.y, rect.x - strip.x + rect.width, rect.y - strip.y + rect.height];
        ["x0", "y0", "x1", "y1"].forEach((name, index) => this._uniform(name, local[index]));
        this._uniform("radius", Math.min(radius, rect.width / 2, rect.height / 2));
        this._dock = { x: rect.x + this._origin.x, y: rect.y + this._origin.y, width: rect.width, height: rect.height };
        this._strip = { x: strip.x + this._origin.x, y: strip.y + this._origin.y, width: strip.width, height: strip.height };
        if (this._high)
            this._checkWindows();
    }

    // Window actors on the current workspace that overlap `area`, in stage
    // coordinates, bottom first.
    _windowsOver(area) {
        const workspace = global.workspace_manager.get_active_workspace();
        return global.get_window_actors().filter(actor => {
            const window = actor.get_meta_window();
            if (!window || window.minimized || !actor.visible || !window.located_on_workspace(workspace))
                return false;
            const type = window.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK)
                return false;
            const frame = window.get_buffer_rect();
            return frame.x < area.x + area.width && area.x < frame.x + frame.width &&
                frame.y < area.y + area.height && area.y < frame.y + frame.height;
        });
    }

    // Fast: hidden while a window overlaps the dock. High: the windows
    // across the strip are cloned, rebuilt only when that set changes; each
    // clone follows its window's position on its own.
    _checkWindows() {
        if (!this._dock)
            return;
        if (!this._high) {
            this.actor.visible = this._windowsOver(this._dock).length === 0;
            return;
        }
        const sources = this._windowsOver(this._strip);
        if (sources.length === this._windowSources.length &&
            sources.every((actor, index) => actor === this._windowSources[index]))
            return;
        this._clearWindows();
        this._windowSources = sources;
        this._windowClones = sources.map(actor => {
            const clone = new Clutter.Clone({ source: actor });
            clone.add_constraint(new Clutter.BindConstraint({ source: actor, coordinate: Clutter.BindCoordinate.POSITION }));
            this._windows.add_child(clone);
            return clone;
        });
    }

    _clearWindows() {
        this._windowClones.forEach(clone => clone.destroy());
        this._windowClones = [];
        this._windowSources = [];
    }

    destroy() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._signals.forEach(([object, id]) => object.disconnect(id));
        this._signals = [];
        this._clearWindows();
        this.actor.destroy();
    }
}
