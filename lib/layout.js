// DockLayout (SPEC §1, §2, §5): dock geometry as plain numbers.
//
// Work happens on two axes: "main" runs along the dock (x for the bottom
// edge, y for left/right) and "cross" grows away from the screen edge. Rects
// are converted to monitor coordinates only at the end.
//
// computeRest() lays the dock out at rest and shrinks it to fit the monitor.
// place() takes per-element sizes (from lib/magnification.js) and lays them
// out without overlap, base-aligned, inside the monitor.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

var POSITIONS = ["bottom", "left", "right"];

function _mainAxis(monitor, position) {
    return position === "bottom"
        ? { start: monitor.x, length: monitor.width }
        : { start: monitor.y, length: monitor.height };
}

function _rect(monitor, position, mainStart, mainLength, crossFromEdge, crossLength) {
    if (position === "bottom") {
        return {
            x: mainStart,
            y: monitor.y + monitor.height - crossFromEdge - crossLength,
            width: mainLength,
            height: crossLength
        };
    }
    return {
        x: position === "left"
            ? monitor.x + crossFromEdge
            : monitor.x + monitor.width - crossFromEdge - crossLength,
        y: mainStart,
        width: crossLength,
        height: mainLength
    };
}

function _point(monitor, position, main, crossFromEdge) {
    const rect = _rect(monitor, position, main, 0, crossFromEdge, 0);
    return { x: rect.x, y: rect.y };
}

// Element kinds for the dock's sections: pinned apps | running apps that
// are not pinned | trash. A line splits pinned from running only when both
// exist; the trash always has its line when anything comes before it.
// entries: [{ pinned, trash }]. Returns { kinds, roles }, where roles names
// each separator ("running" or "trash") so animations can tell them apart.
function sections(entries) {
    const kinds = [];
    const roles = [];
    let previous = null;
    entries.forEach(entry => {
        const section = entry.trash ? "trash" : entry.pinned ? "pinned" : "running";
        if (previous && section !== previous && (section === "trash" || previous === "pinned")) {
            kinds.push("separator");
            roles.push(section);
        }
        kinds.push("icon");
        previous = section;
    });
    return { kinds: kinds, roles: roles };
}

// kinds: element kinds in order, "icon" or "separator".
// tokens: resolved tokens in physical pixels (lib/tokens.js).
// monitor: { x, y, width, height } in physical pixels.
// edgeInset: space already taken at the dock's edge (e.g. a Cinnamon panel);
// the dock floats dock.bottomOffset beyond it.
function computeRest(kinds, tokens, monitor, position, edgeInset) {
    if (POSITIONS.indexOf(position) < 0)
        throw new Error("layout: unknown position " + position);
    kinds.forEach(kind => {
        if (kind !== "icon" && kind !== "separator")
            throw new Error("layout: unknown element kind " + kind);
    });

    const base = tokens["icon.baseSize"];
    const gap = tokens["icon.gap"];
    const padX = tokens["dock.paddingX"];
    const separatorWidth = tokens["separator.width"];
    const margin = tokens["dock.bottomOffset"];
    const icons = kinds.filter(kind => kind === "icon").length;
    const separators = kinds.length - icons;
    const gaps = Math.max(0, kinds.length - 1);

    // Everything except separator width scales with the icon size, so the
    // length is linear in the ratio and the fitting ratio has a closed form.
    const axis = _mainAxis(monitor, position);
    const available = axis.length - 2 * margin;
    const scalable = 2 * padX + icons * base + gaps * gap;
    const ratio = Math.min(1, (available - separators * separatorWidth) / scalable);
    if (!(ratio > 0))
        throw new Error("layout: dock cannot fit on monitor");

    const elements = [];
    let cursor = padX * ratio;
    kinds.forEach((kind, index) => {
        if (index > 0)
            cursor += gap * ratio;
        const length = kind === "icon" ? base * ratio : separatorWidth;
        elements.push({ kind: kind, start: cursor, length: length });
        cursor += length;
    });
    const length = cursor + padX * ratio;
    // Pixel-aligned, so the rounded pill and the icons keep equal edges.
    const start = Math.round(axis.start + (axis.length - length) / 2);

    return {
        kinds: kinds.slice(),
        tokens: tokens,
        monitor: monitor,
        position: position,
        edgeInset: edgeInset || 0,
        ratio: ratio,
        iconSize: base * ratio,
        // Rest offsets are relative to `start`; centers are absolute.
        elements: elements,
        start: start,
        length: length,
        crossLength: (base + 2 * tokens["dock.paddingY"]) * ratio,
        areaStart: axis.start + margin,
        areaEnd: axis.start + axis.length - margin,
        centers: elements.map(element => element.kind === "icon"
            ? start + element.start + element.length / 2
            : null)
    };
}

// Concentric corner radii: each nested shape keeps the radius of the shape
// around it minus the space between their edges, measured across the dock
// (paddingY), so the curves stay parallel. Scales with the fitting ratio.
function radii(rest) {
    const tokens = rest.tokens;
    const dock = tokens["dock.cornerRadius"] * rest.ratio;
    return { dock: dock, icon: Math.max(0, dock - tokens["dock.paddingY"] * rest.ratio) };
}

// Maps a rest offset to the magnified layout, piecewise over pads, gaps and
// elements. Continuous in `offset`, so the dock never jumps as the pointer
// crosses from one icon to the next.
function _magnifiedOffset(rest, lengths, offset) {
    let restCursor = 0;
    let magnifiedCursor = 0;
    const segments = [];
    rest.elements.forEach((element, index) => {
        segments.push([element.start - restCursor, element.start - restCursor]);
        segments.push([element.length, lengths[index]]);
        restCursor = element.start + element.length;
    });
    segments.push([rest.length - restCursor, rest.length - restCursor]);

    restCursor = 0;
    for (const [restLength, magnifiedLength] of segments) {
        if (offset <= restCursor + restLength) {
            const fraction = restLength > 0 ? (offset - restCursor) / restLength : 0;
            return magnifiedCursor + fraction * magnifiedLength;
        }
        restCursor += restLength;
        magnifiedCursor += magnifiedLength;
    }
    return magnifiedCursor;
}

// sizes: one entry per element, an icon size or null (rest size), as
// returned by Magnification.sizes(). pointer: main-axis coordinate or null.
function place(rest, sizes, pointer) {
    const tokens = rest.tokens;
    const restIcon = rest.iconSize;
    const lengths = rest.elements.map((element, index) => {
        if (element.kind !== "icon")
            return element.length;
        const size = sizes && sizes[index] !== null && sizes[index] !== undefined
            ? sizes[index]
            : restIcon;
        return Math.max(restIcon, size);
    });

    // Scale magnification down uniformly when it would not fit on screen.
    const available = rest.areaEnd - rest.areaStart;
    let extra = 0;
    lengths.forEach((length, index) => extra += length - rest.elements[index].length);
    if (extra > 0 && rest.length + extra > available) {
        const factor = Math.max(0, available - rest.length) / extra;
        lengths.forEach((length, index) => {
            const restLength = rest.elements[index].length;
            lengths[index] = restLength + (length - restLength) * factor;
        });
        extra *= factor;
    }
    const length = rest.length + extra;

    // Keep the point under the pointer fixed, so the hovered icon stays under
    // the cursor and its neighbors are pushed outwards.
    let start = rest.start;
    if (pointer !== null && pointer !== undefined && extra > 0) {
        const offset = Math.min(rest.length, Math.max(0, pointer - rest.start));
        start = rest.start + offset - _magnifiedOffset(rest, lengths, offset);
    } else {
        start = rest.start - extra / 2;
    }
    start = Math.min(rest.areaEnd - length, Math.max(rest.areaStart, start));

    const monitor = rest.monitor;
    const position = rest.position;
    const margin = rest.edgeInset + tokens["dock.bottomOffset"];
    const padY = tokens["dock.paddingY"] * rest.ratio;
    const separatorLength = tokens["separator.height"] * rest.ratio;
    const indicatorDiameter = tokens["indicator.diameter"] * rest.ratio;
    const indicatorCross = margin + tokens["indicator.edgeGap"] * rest.ratio + indicatorDiameter / 2;

    let cursor = start + tokens["dock.paddingX"] * rest.ratio;
    const items = rest.elements.map((element, index) => {
        if (index > 0)
            cursor += tokens["icon.gap"] * rest.ratio;
        const main = cursor;
        const size = lengths[index];
        cursor += size;

        if (element.kind === "separator") {
            return {
                kind: "separator",
                rect: _rect(monitor, position, main, size,
                    margin + (rest.crossLength - separatorLength) / 2, separatorLength)
            };
        }
        return {
            kind: "icon",
            size: size,
            // Base-aligned: every icon starts at the same distance from the edge.
            rect: _rect(monitor, position, main, size, margin + padY, size),
            indicator: {
                center: _point(monitor, position, main + size / 2, indicatorCross),
                diameter: indicatorDiameter
            }
        };
    });

    return {
        position: position,
        iconSize: restIcon,
        dock: _rect(monitor, position, start, length, margin, rest.crossLength),
        items: items
    };
}
