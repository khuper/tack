import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rotateNdjsonFile, safeReadNdjson } from "../../src/lib/ndjson.js";

let originalCwd = "";
let tmpDir = "";

describe("ndjson", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-ndjson-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips corrupted lines", () => {
    fs.writeFileSync(
      "logs.ndjson",
      ['{"event":"ok1"}', "{bad-json", '{"event":"ok2"}'].join("\n"),
      "utf-8"
    );
    const events = safeReadNdjson<{ event: string }>("logs.ndjson");
    expect(events.map((e) => e.event)).toEqual(["ok1", "ok2"]);
  });

  it("rotates oversized ndjson files", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `{"event":"${i}"}`).join("\n");
    fs.writeFileSync("logs.ndjson", `${lines}\n`, "utf-8");
    rotateNdjsonFile("logs.ndjson", 100, 5);
    const after = fs.readFileSync("logs.ndjson", "utf-8").trim().split("\n");
    expect(after.length).toBe(5);
  });
});
