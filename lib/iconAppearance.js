// Icon appearances (SPEC §3 "Ícones"): the app's own icon recolored by a
// fragment shader, as Linux apps ship no light, dark or tinted variants.
// No mask is added: each icon keeps its own shape.
//
//   light   - a soft white wash, darker areas more; the drawing stays.
//   dark    - light, colorless areas darken; colors stay, a little brighter.
//   tinted  - one color, the tint, from dark to light by the icon's luminance.
//   clear   - colorless and translucent, so the glass shows through.

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;

const { floatValue } = require("./lib/glassBlur.js");

var APPEARANCES = ["default", "light", "dark", "tinted", "clear"];

// Premultiplied in and out. mode: the index in APPEARANCES.
const SHADER = `
uniform sampler2D tex;
uniform float mode;
uniform float tintR;
uniform float tintG;
uniform float tintB;

void main() {
    vec4 color = texture2D(tex, cogl_tex_coord_in[0].xy);
    float alpha = color.a;
    vec3 rgb = alpha > 0.0 ? color.rgb / alpha : vec3(0.0);
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float saturation = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
    float neutral = 1.0 - clamp(saturation * 2.5, 0.0, 1.0);
    if (mode < 1.5) {
        rgb = mix(rgb, vec3(1.0), 0.22 - 0.12 * luma);
    } else if (mode < 2.5) {
        rgb = mix(min(rgb * 1.1, 1.0), vec3(0.16) + rgb * 0.08, neutral * smoothstep(0.45, 0.85, luma));
    } else if (mode < 3.5) {
        vec3 tint = vec3(tintR, tintG, tintB);
        rgb = luma < 0.5 ? mix(tint * 0.25, tint, luma * 2.0) : mix(tint, vec3(1.0), (luma - 0.5) * 1.6);
    } else {
        rgb = vec3(0.55 + luma * 0.45);
        alpha *= 0.6;
    }
    cogl_color_out = vec4(rgb * alpha, alpha) * cogl_color_in.a;
}`;

// Adds the effect for `appearance` to `actor`; "default" or an unknown
// value leaves it as it is. tint: a CSS color, used by "tinted".
function apply(actor, appearance, tint) {
    const mode = APPEARANCES.indexOf(appearance);
    if (mode <= 0)
        return;
    const effect = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
    effect.set_shader_source(SHADER);
    const sampler = new GObject.Value();
    sampler.init(GObject.TYPE_INT);
    sampler.set_int(0);
    effect.set_uniform_value("tex", sampler);
    effect.set_uniform_value("mode", floatValue(mode));
    const [parsed, color] = Clutter.Color.from_string(tint || "");
    const rgb = parsed ? [color.red, color.green, color.blue] : [10, 132, 255];
    ["tintR", "tintG", "tintB"].forEach((name, index) =>
        effect.set_uniform_value(name, floatValue(rgb[index] / 255)));
    actor.add_effect(effect);
}
