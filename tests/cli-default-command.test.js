import { test } from "node:test";
import assert from "node:assert";
import { getDefaultCommand } from "../dist/lib/cli.js";

test("getDefaultCommand returns init when .tack/ does not exist", () => {
  assert.strictEqual(getDefaultCommand(() => false), "init");
});

test("getDefaultCommand returns watch when .tack/ exists", () => {
  assert.strictEqual(getDefaultCommand(() => true), "watch");
});
