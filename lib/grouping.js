// Groups windows into dock items (SPEC §7 "Janelas", §8 grouped-window-list).
//
// Inputs are plain descriptors built by lib/appTracker.js from Muffin and
// Cinnamon objects, so the rules are testable without a session:
//   pinned:  [{ desktopId, wmClasses }] in dock order
//   windows: [{ id, appId, wmClasses, sequence, monitor, workspace,
//               allWorkspaces, minimized, focused, attention, skipTaskbar }]
//   runningAppIds: app ids Cinnamon reports as running, with or without windows
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

function normalizeId(value) {
    return String(value || "").trim().toLowerCase().replace(/\.desktop$/, "");
}

// WM_CLASS first so several Chrome web apps stay distinct even when Cinnamon
// attributes all their windows to the browser app; desktop id second.
function _findPinned(pinned, window) {
    for (let i = 0; i < pinned.length; i++) {
        if (window.wmClasses.some(wmClass => pinned[i].wmClasses.indexOf(wmClass) >= 0))
            return i;
    }
    for (let i = 0; i < pinned.length; i++) {
        if (pinned[i].desktopId === window.appId)
            return i;
    }
    return -1;
}

function _item(key, desktopId, pinned) {
    return { key: key, desktopId: desktopId, pinned: pinned, windows: [] };
}

function group(pinned, windows, runningAppIds) {
    const specs = pinned.map(spec => ({
        desktopId: normalizeId(spec.desktopId),
        wmClasses: (spec.wmClasses || []).map(normalizeId).filter(Boolean)
    }));
    const pinnedItems = specs.map(spec => _item("pinned:" + spec.desktopId, spec.desktopId, true));
    const dynamic = new Map();

    windows
        .filter(window => !window.skipTaskbar)
        .map(window => Object.assign({}, window, {
            appId: normalizeId(window.appId),
            wmClasses: (window.wmClasses || []).map(normalizeId).filter(Boolean)
        }))
        .sort((a, b) => a.sequence - b.sequence)
        .forEach(window => {
            const index = _findPinned(specs, window);
            if (index >= 0) {
                pinnedItems[index].windows.push(window);
                return;
            }
            const id = window.appId || "wm:" + (window.wmClasses[0] || window.id);
            if (!dynamic.has(id))
                dynamic.set(id, _item("running:" + id, window.appId, false));
            dynamic.get(id).windows.push(window);
        });

    // Unpinned apps keep launch order (first window), like the macOS Dock.
    const running = new Set((runningAppIds || []).map(normalizeId));
    return pinnedItems.concat(Array.from(dynamic.values())).map(item => {
        item.running = item.windows.length > 0 || running.has(item.desktopId);
        return item;
    });
}

// The item seen from one workspace: only its windows there, plus windows
// shown on every workspace (sticky, or on monitors without workspaces).
// RUNNING stays global, as in facts().
function onWorkspace(item, workspaceIndex) {
    return Object.assign({}, item, {
        windows: item.windows.filter(window =>
            window.allWorkspaces || window.workspace === workspaceIndex)
    });
}

// Facts for one item, optionally restricted to the windows on one monitor.
// RUNNING stays global: an app is running even with no window on this monitor.
function facts(item, monitorIndex) {
    const windows = monitorIndex === undefined || monitorIndex === null
        ? item.windows
        : item.windows.filter(window => window.monitor === monitorIndex);
    return {
        pinned: item.pinned,
        running: item.running,
        hasWindows: windows.length > 0,
        focused: windows.some(window => window.focused),
        minimized: windows.some(window => window.minimized),
        attention: windows.some(window => window.attention)
    };
}
