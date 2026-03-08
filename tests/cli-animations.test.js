import test from "node:test";
import assert from "node:assert";
import { resolveAnimationsEnabled } from "../dist/lib/animation.js";

test("animations default to interactive watch sessions", () => {
  assert.strictEqual(resolveAnimationsEnabled({}, {}, true), true);
});

test("no-animations disables mascot motion", () => {
  assert.strictEqual(resolveAnimationsEnabled({ "no-animations": true }, {}, true), false);
});

test("environment can disable animations by default", () => {
  assert.strictEqual(resolveAnimationsEnabled({}, { TACK_ANIMATIONS: "off" }, true), false);
});

test("explicit CLI preference overrides environment default", () => {
  assert.strictEqual(resolveAnimationsEnabled({ animations: "on" }, { TACK_ANIMATIONS: "off" }, true), true);
});
