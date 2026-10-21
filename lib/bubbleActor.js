// St side of lib/bubble.js: paints the bubble outline on an actor.

const Cairo = imports.cairo;

const BubbleShape = require("./lib/bubble.js");
const Platform = require("./lib/platform.js");

// Paints a lib/bubble.js outline as `actor`'s content, under its children and
// its own (transparent) style, so it follows every move, fade and scale.
// Colors come from the stylesheet: -bubble-fill and -bubble-border.
class Bubble {
    constructor(actor, side, tokens) {
        this.actor = actor;
        this.side = side;
        this.metrics = {
            radius: tokens["bubble.radius"],
            arrowWidth: tokens["bubble.arrowWidth"],
            arrowHeight: tokens["bubble.arrowHeight"]
        };
        this.tip = 0;
        this._surface = Platform.paintSurface(actor, (cr, width, height) => this._draw(cr, width, height));
    }

    // The arrow's room on its side, as a logical style length.
    padding(scaleFactor, extra) {
        const property = { bottom: "padding-bottom", left: "padding-left", right: "padding-right" }[this.side];
        return property + ": " + (this.metrics.arrowHeight / scaleFactor + (extra || 0)) + "px;";
    }

    // tip: where the arrow points, along the arrow's edge in actor pixels.
    setTip(tip) {
        if (Math.abs(tip - this.tip) < 0.5)
            return;
        this.tip = tip;
        this._surface.invalidate();
    }

    _draw(cr, width, height) {
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        const node = this.actor.get_theme_node();
        const fill = node.get_color("-bubble-fill");
        const border = node.get_color("-bubble-border");
        const place = BubbleShape.transform(width, height, this.side);
        const frame = BubbleShape.frame(width, height, this.side);
        const tip = BubbleShape.canonicalTip(this.tip, width, height, this.side);
        cr.translate(place.x, place.y);
        cr.rotate(place.angle);
        // Half a pixel in, so the 1 px border stays inside the actor.
        cr.translate(0.5, 0.5);
        BubbleShape.outline(frame.length - 1, frame.depth - 1, tip - 0.5, this.metrics).forEach(segment => {
            const [op, ...args] = segment;
            if (op === "move")
                cr.moveTo(...args);
            else if (op === "line")
                cr.lineTo(...args);
            else if (op === "arc")
                cr.arc(...args);
            else if (op === "curve")
                cr.curveTo(...args);
            else
                cr.closePath();
        });
        cr.setSourceRGBA(fill.red / 255, fill.green / 255, fill.blue / 255, fill.alpha / 255);
        cr.fillPreserve();
        cr.setSourceRGBA(border.red / 255, border.green / 255, border.blue / 255, border.alpha / 255);
        cr.setLineWidth(1);
        cr.stroke();
        cr.$dispose();
        return true;
    }
}
