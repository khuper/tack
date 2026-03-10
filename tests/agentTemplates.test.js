import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import {
  MARKER_END,
  buildBlock,
  findExistingBlock,
  getAvailableTargets,
  getDestinationPath,
  replaceBlock,
} from "../dist/lib/agentTemplates.js";

test("buildBlock creates a versioned instruction block", () => {
  const block = buildBlock("1.2.3");

  assert.match(block, /^<!-- BEGIN TACK AGENT INSTRUCTIONS v1\.2\.3 -->/);
  assert.match(block, /# Tack Workflow/);
  assert.ok(block.endsWith(MARKER_END));
});

test("findExistingBlock locates the block by markers", () => {
  const content = ["# Notes", "", buildBlock("0.1.0"), "", "After"].join("\n");

  const block = findExistingBlock(content);
  assert.ok(block);
  assert.strictEqual(block.start, 2);
  assert.ok(block.end > block.start);
});

test("replaceBlock preserves surrounding content", () => {
  const original = ["before", buildBlock("0.1.0"), "after"].join("\r\n");
  const updated = replaceBlock(original, buildBlock("0.2.0"));

  assert.match(updated, /^before\r\n/);
  assert.match(updated, /<!-- BEGIN TACK AGENT INSTRUCTIONS v0\.2\.0 -->/);
  assert.match(updated, /\r\nafter$/);
});

test("findExistingBlock rejects malformed markers", () => {
  assert.throws(
    () => findExistingBlock("<!-- BEGIN TACK AGENT INSTRUCTIONS v0.1.0 -->\n# Tack Workflow"),
    /Malformed Tack instruction markers\./
  );
  assert.throws(
    () => findExistingBlock("text\n<!-- END TACK AGENT INSTRUCTIONS -->"),
    /Malformed Tack instruction markers\./
  );
});

test("target helpers expose supported paths", () => {
  const repoRoot = path.join("repo", "root");

  assert.deepStrictEqual(getAvailableTargets(), ["claude", "codex", "generic"]);
  assert.strictEqual(getDestinationPath("claude", repoRoot), path.join(repoRoot, "CLAUDE.md"));
  assert.strictEqual(getDestinationPath("codex", repoRoot), path.join(repoRoot, "AGENTS.md"));
  assert.strictEqual(getDestinationPath("generic", repoRoot), path.join(repoRoot, ".tack", "AGENT.md"));
});
