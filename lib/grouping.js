// Groups windows into dock items (SPEC §7 "Janelas", §8 grouped-window-list).
//
// Inputs are plain descriptors built by lib/appTracker.js from Muffin and
// Cinnamon objects, so the rules are testable without a session:
//   pinned:  [{ desktopId, wmClasses }] in dock order
//   windows: [{ id, appId, wmClasses, sequence, monitor, workspace,
//               allWorkspaces, minimized, focused, attention, skipTaskbar }]
//   runningAppIds: app ids Cinnamon reports as running, with or without windows
//   launchers: [{ desktopId, wmClass }] of installed apps' StartupWMClass
//
// Pure module: top-level `var`/`function` only (see lib/tokens.js).

function normalizeId(value) {
    return String(value || "").trim().toLowerCase().replace(/\.desktop$/, "");
}

// The window's own WM_CLASS instance first, so several Chrome web apps stay
// distinct even when Cinnamon attributes their windows to the browser app;
// desktop id second. Any WM_CLASS last, and only for windows of no known
// app: a web app that is not pinned must not land on the pinned browser,
// whose class its windows share.
function _findPinned(pinned, window) {
    const own = window.wmClasses[window.wmClasses.length - 1];
    for (let i = 0; own && i < pinned.length; i++) {
        if (pinned[i].wmClasses.indexOf(own) >= 0)
            return i;
    }
    for (let i = 0; window.appId && i < pinned.length; i++) {
        if (pinned[i].desktopId === window.appId)
            return i;
    }
    for (let i = 0; !window.appId && i < pinned.length; i++) {
        if (window.wmClasses.some(wmClass => pinned[i].wmClasses.indexOf(wmClass) >= 0))
            return i;
    }
    return -1;
}

// A launcher whose StartupWMClass is the window's instance owns it, so an
// unpinned web app keeps its own item, unless the app Cinnamon
// chose claims that class too.
function _resolveAppId(window, owners) {
    const own = window.wmClasses[window.wmClasses.length - 1];
    const claims = (own && owners.get(own)) || [];
    return !claims.length || claims.indexOf(window.appId) >= 0 ? window.appId : claims[0];
}

function _item(key, desktopId, pinned) {
    return { key: key, desktopId: desktopId, pinned: pinned, windows: [] };
}

function group(pinned, windows, runningAppIds, launchers) {
    const owners = new Map();
    (launchers || []).forEach(launcher => {
        const wmClass = normalizeId(launcher.wmClass);
        if (wmClass)
            owners.set(wmClass, (owners.get(wmClass) || []).concat(normalizeId(launcher.desktopId)));
    });
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
        .map(window => Object.assign(window, { appId: _resolveAppId(window, owners) }))
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
