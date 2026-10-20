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
        id: id, appId: "", wmClasses: [], sequence: id, monitor: 0, workspace: 0,
        minimized: false, focused: false, attention: false, skipTaskbar: false
    }, props);
}

function keys(items) {
    return items.map(item => item.key).join(",");
}

var tests = {
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
        const { AppFlag } = State;
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0])), AppFlag),
            "PINNED|RUNNING|FOCUSED|MINIMIZED|ATTENTION");
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0], 0)), AppFlag),
            "PINNED|RUNNING|MINIMIZED|ATTENTION", "monitor 0");
        assert.equal(State.describe(State.fromFacts(Grouping.facts(items[0], 1)), AppFlag),
            "PINNED|RUNNING|FOCUSED", "monitor 1");
    }
};
