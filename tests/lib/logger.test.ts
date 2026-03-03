import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureTackDir, logsPath } from "../../src/lib/files.js";
import { log } from "../../src/lib/logger.js";

let originalCwd = "";
let tmpDir = "";

describe("logger", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-logger-"));
    process.chdir(tmpDir);
    ensureTackDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends ndjson events", () => {
    log({ event: "init", spec_seeded: true, systems_detected: 1 });
    log({ event: "spec:updated", field: "allowed_systems", diff: "added auth" });

    const lines = fs.readFileSync(logsPath(), "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.event).toBe("init");
    expect(first.spec_seeded).toBeTrue();
    expect(typeof first.ts).toBe("string");
  });
});
