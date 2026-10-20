const Grouping = imports.lib.grouping;
const State = imports.lib.state;

const PINNED = [
    { desktopId: "nemo.desktop", wmClasses: ["Nemo"] },
    { desktopId: "chrome-jira-Profile_3.desktop", wmClasses: ["crx_jira"] },
    { desktopId: "chrome-chat-Profile_3.desktop", wmClasses: ["crx_chat"] }
];

let nextId = 1;
function win(props) {
    const id = nextId++;
    return Object.assign({
        id: id, appId: "", wmClasses: [], sequence: id, monitor: 0, workspace: 0, allWorkspaces: false,
        minimized: false, focused: false, attention: false, skipTaskbar: false
    }, props);
}

function keys(items) {
    return items.map(item => item.key).join(",");
}

var tests = {
    "recent apps: closed ones first, without running or pinned ones, at most max"(assert) {
        const recent = (saved, before, after, pinned) =>
            Grouping.recentApps(saved, before, after, pinned || [], 3).join();
        assert.equal(recent(["a.desktop"], ["b.desktop", "c.desktop"], ["c.desktop"]), "b.desktop,a.desktop");
        assert.equal(recent([], ["a.desktop", "b.desktop"], []), "b.desktop,a.desktop", "last launched first");
        assert.equal(recent(["a.desktop", "b.desktop"], [], ["a.desktop"]), "b.desktop", "running again");
        assert.equal(recent(["a.desktop", "b.desktop"], [], [], ["B.desktop"]), "a.desktop", "pinned");
        assert.equal(recent(["b.desktop", "c.desktop", "d.desktop"], ["a.desktop", "b.desktop"], []),
            "b.desktop,a.desktop,c.desktop", "deduplicated and capped");
    },

    "a reorder keeps saved ids the dock does not show"(assert) {
        const saved = ["a.desktop", "gone.desktop", "b.desktop", "c.desktop"];
        assert.equal(Grouping.reorderPinned(saved, ["c.desktop", "a.desktop", "b.desktop"]).join(),
            "c.desktop,gone.desktop,a.desktop,b.desktop");
        assert.equal(Grouping.reorderPinned(saved, ["a.desktop", "b.desktop", "c.desktop"]).join(), saved.join(), "unchanged");
    },

    "an unpinned web app keeps its own item beside the pinned browser"(assert) {
        const pinned = [{ desktopId: "google-chrome.desktop", wmClasses: ["google-chrome"] }];
        const items = Grouping.group(pinned, [
            win({ appId: "google-chrome.desktop", wmClasses: ["Google-chrome", "google-chrome"] }),
            win({ appId: "chrome-wa-Default.desktop", wmClasses: ["Google-chrome", "crx_wa"] })
        ]);
        assert.equal(keys(items), "pinned:google-chrome,running:chrome-wa-default");
        assert.equal(items[0].windows.length, 1, "browser keeps only its window");
    },

    "a web app credited to the browser goes to the launcher of its WM_CLASS"(assert) {
        const launchers = [
            { desktopId: "google-chrome.desktop", wmClass: "google-chrome" },
            { desktopId: "chrome-wa-Default.desktop", wmClass: "crx_wa" }
        ];
        const items = Grouping.group([], [
            win({ appId: "google-chrome.desktop", wmClasses: ["Google-chrome", "crx_wa"] }),
            win({ appId: "google-chrome.desktop", wmClasses: ["Google-chrome", "google-chrome"] })
        ], [], launchers);
        assert.equal(keys(items), "running:chrome-wa-default,running:google-chrome");
        assert.equal(items[0].desktopId, "chrome-wa-default");
    },

    "the chosen app wins when it claims the class too"(assert) {
        const launchers = [
            { desktopId: "a.desktop", wmClass: "shared" },
            { desktopId: "b.desktop", wmClass: "shared" }
        ];
        const items = Grouping.group([], [win({ appId: "b.desktop", wmClasses: ["shared"] })], [], launchers);
        assert.equal(keys(items), "running:b");
    },

    "pinned items keep their order with or without windows"(assert) {
        const items = Grouping.group(PINNED, []);
        assert.equal(keys(items),
            "pinned:nemo,pinned:chrome-jira-profile_3,pinned:chrome-chat-profile_3");
        items.forEach(item => assert.ok(!item.running, item.key));
    },

    "web apps are told apart by WM_CLASS despite sharing the browser app id"(assert) {
        const items = Grouping.group(PINNED, [
            win({ appId: "google-chrome.desktop", wmClasses: ["crx_chat"] }),
            win({ appId: "google-chrome.desktop", wmClasses: ["crx_jira"] })
        ]);
        assert.equal(items[1].windows.length, 1, "jira");
        assert.equal(items[2].windows.length, 1, "chat");
        assert.equal(items.length, 3, "no dynamic browser item");
    },

    "desktop id matches when WM_CLASS does not"(assert) {
        const items = Grouping.group(PINNED, [win({ appId: "nemo.desktop", wmClasses: ["other"] })]);
        assert.equal(items[0].windows.length, 1);
    },

    "unpinned apps follow launch order and group their windows"(assert) {
        const late = win({ appId: "firefox.desktop", sequence: 50 });
        const early = win({ appId: "ghostty.desktop", sequence: 10 });
        const second = win({ appId: "firefox.desktop", sequence: 60 });
        const items = Grouping.group([], [late, second, early]);
        assert.equal(keys(items), "running:ghostty,running:firefox");
        assert.equal(items[1].windows.length, 2);
    },

    "windows hidden from task lists are ignored"(assert) {
        const items = Grouping.group([], [win({ appId: "x.desktop", skipTaskbar: true })]);
        assert.equal(items.length, 0);
    },

    "window-less fallback groups by WM_CLASS"(assert) {
        const items = Grouping.group([], [win({ wmClasses: ["Foo"] }), win({ wmClasses: ["foo"] })]);
        assert.equal(keys(items), "running:wm:foo");
        assert.equal(items[0].windows.length, 2);
    },

    "running without windows is still running"(assert) {
        const items = Grouping.group(PINNED, [], ["nemo.desktop"]);
        const facts = Grouping.facts(items[0]);
        assert.ok(facts.running && !facts.hasWindows, "running, no window");
    },

    "facts combine into independent flags and respect monitors"(assert) {
        const items = Grouping.group(PINNED, [
            win({ appId: "nemo.desktop", monitor: 0, minimized: true, attention: true }),
            win({ appId: "nemo.desktop", monitor: 1, focused: true })
        ]);
        assert.ok(Grouping.onMonitor(items[0], 1).every(window => window.focused), "one window each");
        assert.equal(Grouping.onMonitor(items[0], 1).length, 1);
        assert.equal(Grouping.onMonitor(items[0], 2).length, 0, "none elsewhere");
        const { AppFlag } = State;
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0])), AppFlag),
            "PINNED|RUNNING|FOCUSED|MINIMIZED|ATTENTION");
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0], 0)), AppFlag),
            "PINNED|RUNNING|MINIMIZED|ATTENTION", "monitor 0");
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0], 1)), AppFlag),
            "PINNED|RUNNING|FOCUSED", "monitor 1");
    },

    "a workspace sees its own and sticky windows"(assert) {
        const items = Grouping.group(PINNED, [
            win({ appId: "nemo.desktop", workspace: 0, focused: true }),
            win({ appId: "nemo.desktop", workspace: 1 }),
            win({ wmClasses: ["Sticky"], workspace: -1, allWorkspaces: true })
        ]);
        const nemo = items[0];
        assert.equal(Grouping.onWorkspace(nemo, 0).windows.length, 1);
        assert.ok(Grouping.facts(Grouping.onWorkspace(nemo, 0)).focused, "focused on 0");
        const away = Grouping.facts(Grouping.onWorkspace(nemo, 2));
        assert.ok(away.running && !away.hasWindows, "no window on 2, still running");
        assert.equal(nemo.windows.length, 2, "original untouched");
        const sticky = items[items.length - 1];
        assert.equal(Grouping.onWorkspace(sticky, 3).windows.length, 1, "sticky everywhere");
    }
};
