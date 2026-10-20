// Runs the pure-module tests with cjs, outside Cinnamon:
//   cd <project> && cjs tests/run.js
imports.searchPath.unshift(".");

const SUITES = ["testTokens", "testState", "testGrouping", "testMagnification", "testAnimation", "testLayout", "testScenarios"];

const assert = {
    equal(actual, expected, label) {
        if (actual !== expected)
            throw new Error((label ? label + ": " : "") +
                "expected " + expected + ", got " + actual);
    },
    near(actual, expected, epsilon, label) {
        if (!(Math.abs(actual - expected) <= epsilon))
            throw new Error((label ? label + ": " : "") +
                "expected " + expected + " ± " + epsilon + ", got " + actual);
    },
    ok(value, label) {
        if (!value)
            throw new Error(label || "expected truthy value");
    },
    throws(fn, label) {
        try {
            fn();
        } catch (e) {
            return;
        }
        throw new Error("expected throw: " + label);
    }
};

let failures = 0;
let count = 0;
SUITES.forEach(suite => {
    const tests = imports.tests[suite].tests;
    Object.keys(tests).forEach(name => {
        count++;
        try {
            tests[name](assert);
        } catch (e) {
            failures++;
            print("FAIL " + suite + " › " + name + "\n     " + e.message);
        }
    });
});

print((count - failures) + "/" + count + " tests passed");
imports.system.exit(failures ? 1 : 0);
