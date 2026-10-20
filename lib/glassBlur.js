// Liquid Glass backdrop (SPEC §3, experimental): the wallpaper behind the
// dock, blurred on the GPU. A Clutter.Clone of the background, so no pixel
// is read back as St's background-blur does; a fragment shader blurs it and
// cuts it to the dock's rounded rect. See PLAN.md, stage 6.
//
// The actor keeps one size, a strip across the whole monitor: resizing an
// effect's actor reallocates its offscreen texture, which dropped
// magnification to ~36 FPS. Windows cannot be cloned (global.window_group
// paints nothing in a clone), so the blur hides while one is behind the dock
// and the plain glass shows instead.
//
// The blur takes two passes, across then along, by two nested actors with an
// effect each: 2 x 17 samples a pixel instead of 17 x 17, which this
// machine's GPU could not draw at 60 FPS.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

// Samples on each side of a pass, and how often windows are checked.
const TAPS = 8;
const WINDOW_CHECK_MS = 250;

// One pass along (dx, dy). rect: the dock in strip px, grown by `grow` so the
// first pass covers what the second samples; reach: the kernel's half width
// in px, about two standard deviations. Premultiplied in and out.
const SHADER = `
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

void main() {
    vec2 size = vec2(width, height);
    vec2 p = cogl_tex_coord_in[0].xy * size;
    vec2 extent = vec2(x1 - x0, y1 - y0) * 0.5 + grow;
    vec2 q = abs(p - vec2(x0 + x1, y0 + y1) * 0.5) - extent + radius;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float alpha = clamp(0.5 - d, 0.0, 1.0);
    if (alpha <= 0.0) {
        cogl_color_out = vec4(0.0);
        return;
    }
    float spacing = reach / ${TAPS}.0;
    float spread = 2.0 * (reach * 0.5) * (reach * 0.5) + 0.0001;
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = -${TAPS}; i <= ${TAPS}; i++) {
        float offset = float(i) * spacing;
        float weight = exp(-offset * offset / spread);
        sum += texture2D(tex, (p + vec2(dx, dy) * offset) / size) * weight;
        total += weight;
    }
    cogl_color_out = sum / total * alpha * cogl_color_in.a;
}`;

function floatValue(value) {
    const gvalue = new GObject.Value();
    gvalue.init(GObject.TYPE_FLOAT);
    gvalue.set_float(value);
    return gvalue;
}

class GlassBlur {
    // parent: the actor it is drawn in, below `sibling`; origin: parent's
    // stage position; reach: blur half width in px.
    constructor(parent, sibling, origin, horizontal, reach) {
        this._origin = origin;
        this._horizontal = horizontal;
        this._reach = Math.round(reach);
        this._dock = null;
        // Second pass, along the dock's cross axis, and first pass inside it.
        this.actor = new St.Widget({ clip_to_allocation: true, reactive: false });
        // Clipped, or its effect would draw the whole cloned background.
        this._inner = new St.Widget({ clip_to_allocation: true, reactive: false });
        this._clone = new Clutter.Clone({ source: global.background_actor });
        this._inner.add_child(this._clone);
        this.actor.add_child(this._inner);
        this._effects = [this._pass(this._inner, horizontal ? [1, 0] : [0, 1], this._reach),
            this._pass(this.actor, horizontal ? [0, 1] : [1, 0], 0)];
        parent.insert_child_below(this.actor, sibling);
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WINDOW_CHECK_MS, () => {
            this._checkWindows();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pass(actor, direction, grow) {
        const effect = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        effect.set_shader_source(SHADER);
        const sampler = new GObject.Value();
        sampler.init(GObject.TYPE_INT);
        sampler.set_int(0);
        effect.set_uniform_value("tex", sampler);
        effect.set_uniform_value("reach", floatValue(this._reach));
        effect.set_uniform_value("dx", floatValue(direction[0]));
        effect.set_uniform_value("dy", floatValue(direction[1]));
        effect.set_uniform_value("grow", floatValue(grow));
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
        const local = [rect.x - strip.x, rect.y - strip.y, rect.x - strip.x + rect.width, rect.y - strip.y + rect.height];
        ["x0", "y0", "x1", "y1"].forEach((name, index) => this._uniform(name, local[index]));
        this._uniform("radius", Math.min(radius, rect.width / 2, rect.height / 2));
        this._dock = { x: rect.x + this._origin.x, y: rect.y + this._origin.y, width: rect.width, height: rect.height };
    }

    // Hidden while a window on the current workspace overlaps the dock.
    _checkWindows() {
        const dock = this._dock;
        if (!dock)
            return;
        const workspace = global.workspace_manager.get_active_workspace();
        const covered = global.get_window_actors().some(actor => {
            const window = actor.get_meta_window();
            if (!window || window.minimized || !actor.visible || !window.located_on_workspace(workspace))
                return false;
            const type = window.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK)
                return false;
            const frame = window.get_frame_rect();
            return frame.x < dock.x + dock.width && dock.x < frame.x + frame.width &&
                frame.y < dock.y + dock.height && dock.y < frame.y + frame.height;
        });
        this.actor.visible = !covered;
    }

    destroy() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this.actor.destroy();
    }
}
