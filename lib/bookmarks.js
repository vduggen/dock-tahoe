// The file manager's sidebar shortcuts: GTK bookmarks
// (~/.config/gtk-3.0/bookmarks, one "uri [label]" per line) and XApp
// favorites (org.x.apps.favorites "list", "uri::mimetype" each), which Nemo
// shows under "Favoritos".
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

// The folders among the XApp favorites, [{ uri, name }] in list order.
function parseFavorites(list) {
    return (list || []).map(item => {
        const at = String(item).lastIndexOf("::");
        return at < 0 ? { uri: String(item), mime: "" } : { uri: item.slice(0, at), mime: item.slice(at + 2) };
    }).filter(item => item.uri && item.mime === "inode/directory")
        .map(item => ({ uri: item.uri, name: _lastSegment(item.uri) }));
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
