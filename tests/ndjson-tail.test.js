import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNdjsonTailReader, rotateNdjsonFile } from "../dist/lib/ndjson.js";

test("tail reader returns only newly appended NDJSON entries", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-ndjson-tail-"));
  const file = path.join(tmpDir, "logs.ndjson");

  try {
    fs.writeFileSync(file, '{"event":"old"}\n', "utf-8");
    const readTail = createNdjsonTailReader(file);

    fs.appendFileSync(file, '{"event":"new-1"}\n{"event":"new-2"}\n', "utf-8");
    const first = readTail();
    assert.deepStrictEqual(first.map((entry) => entry.event), ["new-1", "new-2"]);
    assert.deepStrictEqual(readTail(), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("tail reader survives NDJSON rotation and resumes from the rewritten file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-ndjson-rotate-"));
  const file = path.join(tmpDir, "logs.ndjson");

  try {
    const lines = Array.from({ length: 8 }, (_, i) => `{"event":"${i}"}`).join("\n");
    fs.writeFileSync(file, `${lines}\n`, "utf-8");
    const readTail = createNdjsonTailReader(file);

    rotateNdjsonFile(file, 10, 3);
    fs.appendFileSync(file, '{"event":"fresh"}\n', "utf-8");

    const afterRotate = readTail();
    assert.deepStrictEqual(afterRotate.map((entry) => entry.event), ["5", "6", "7", "fresh"]);
    assert.deepStrictEqual(readTail(), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("tail reader drops a stale partial line when the file is rotated underneath it", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-ndjson-partial-"));
  const file = path.join(tmpDir, "logs.ndjson");

  try {
    const lines = Array.from({ length: 8 }, (_, i) => `{"event":"${i}"}`).join("\n");
    fs.writeFileSync(file, `${lines}\n`, "utf-8");
    const readTail = createNdjsonTailReader(file);

    // A writer is mid-append when the reader looks.
    fs.appendFileSync(file, '{"event":"partial"', "utf-8");
    assert.deepStrictEqual(readTail(), []);
    fs.appendFileSync(file, "}\n", "utf-8");

    // Rotation rewrites the file shorter than the reader's offset.
    rotateNdjsonFile(file, 10, 3);
    assert.deepStrictEqual(
      readTail().map((entry) => entry.event),
      ["6", "7", "partial"],
      "the first line of the rewritten file must not be glued to the old fragment"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("rotation keeps nothing for a non-positive budget and skips a rewrite that would change nothing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-ndjson-budget-"));
  const file = path.join(tmpDir, "logs.ndjson");

  try {
    fs.writeFileSync(file, '{"event":"a"}\n{"event":"b"}\n', "utf-8");
    rotateNdjsonFile(file, 1, 0);
    assert.strictEqual(fs.readFileSync(file, "utf-8"), "");

    const longLine = `{"event":"${"x".repeat(200)}"}\n`;
    fs.writeFileSync(file, longLine, "utf-8");
    const before = fs.statSync(file).mtimeMs;
    rotateNdjsonFile(file, 10, 5);
    assert.strictEqual(fs.readFileSync(file, "utf-8"), longLine);
    assert.strictEqual(fs.statSync(file).mtimeMs, before, "no rewrite when every line is kept");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
