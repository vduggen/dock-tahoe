// GTK bookmarks (~/.config/gtk-3.0/bookmarks), the favorites in the file
// manager's sidebar: one "uri [label]" per line.
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

// [{ uri, name }] in file order; the name is the label, else the last path
// segment, decoded.
function parse(text) {
    return String(text || "").split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const space = line.indexOf(" ");
        const uri = space < 0 ? line : line.slice(0, space);
        const label = space < 0 ? "" : line.slice(space + 1).trim();
        return { uri: uri, name: label || _lastSegment(uri) };
    });
}

function _lastSegment(uri) {
    const path = uri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").replace(/\/+$/, "");
    const segment = path.slice(path.lastIndexOf("/") + 1) || uri;
    try {
        return decodeURIComponent(segment);
    } catch (e) {
        return segment;
    }
}
