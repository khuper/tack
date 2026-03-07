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
