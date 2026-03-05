import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { addNote, readNotes, compactNotes } from "../../src/lib/notes.js";
import { ensureTackDir, logsPath, notesPath } from "../../src/lib/files.js";
import { safeReadNdjson } from "../../src/lib/ndjson.js";

let originalCwd = "";
let tmpDir = "";

describe("notes", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-notes-"));
    process.chdir(tmpDir);
    ensureTackDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addNote writes a valid ndjson line", () => {
    const ok = addNote({
      type: "tried",
      message: "Investigated note writing.",
      actor: "agent:test",
      related_files: undefined,
    });
    expect(ok).toBeTrue();

    const entries = safeReadNdjson<{ ts: string; type: string; message: string; actor: string }>(
      notesPath()
    );
    expect(entries.length).toBe(1);
    const first = entries[0]!;
    expect(typeof first.ts).toBe("string");
    expect(first.type).toBe("tried");
    expect(first.message).toBe("Investigated note writing.");
    expect(first.actor).toBe("agent:test");
  });

  it("addNote truncates messages over 500 chars and strips control characters", () => {
    const long = "a".repeat(600);
    const withControl = `${long}\nline2\r\t\x01`;
    const ok = addNote({
      type: "discovered",
      message: withControl,
      actor: "user",
      related_files: undefined,
    });
    expect(ok).toBeTrue();

    const entries = safeReadNdjson<{ message: string }>(notesPath());
    expect(entries.length).toBe(1);
    const msg = entries[0]!.message;
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(msg).not.toMatch(/[\r\n\t\x00-\x1f]/);
  });

  it("addNote rejects empty or whitespace-only messages", () => {
    const ok = addNote({
      type: "discovered",
      message: "   \n\t  ",
      actor: "user",
      related_files: undefined,
    });
    expect(ok).toBeFalse();

    const entries = safeReadNdjson<{ message: string }>(notesPath());
    expect(entries.length).toBe(0);
  });

  it("addNote defaults actor to user when missing or blank", () => {
    const ok = addNote({
      type: "tried",
      message: "no actor provided",
      // @ts-expect-error testing runtime defaulting of actor
      actor: "",
      related_files: undefined,
    });
    expect(ok).toBeTrue();

    const entries = safeReadNdjson<{ actor: string }>(notesPath());
    expect(entries.length).toBe(1);
    expect(entries[0]!.actor).toBe("user");
  });

  it("readNotes returns empty array for missing file", () => {
    // Remove notes file if it exists
    const pathToNotes = notesPath();
    if (fs.existsSync(pathToNotes)) {
      fs.rmSync(pathToNotes);
    }
    const notes = readNotes();
    expect(notes).toEqual([]);
  });

  it("readNotes skips corrupt lines and respects limit and type filter", () => {
    const pathToNotes = notesPath();
    const lines = [
      JSON.stringify({
        ts: "2024-01-01T00:00:00.000Z",
        type: "tried",
        message: "first",
        actor: "user",
      }),
      "{bad-json",
      JSON.stringify({
        ts: "2024-02-01T00:00:00.000Z",
        type: "discovered",
        message: "second",
        actor: "user",
      }),
      JSON.stringify({
        ts: "2024-03-01T00:00:00.000Z",
        type: "tried",
        message: "third",
        actor: "user",
      }),
    ];
    fs.writeFileSync(pathToNotes, `${lines.join("\n")}\n`, "utf-8");

    const all = readNotes();
    expect(all.length).toBe(3);

    const limited = readNotes({ limit: 2 });
    expect(limited.length).toBe(2);
    expect(limited[0]!.message).toBe("third");
    expect(limited[1]!.message).toBe("second");

    const triedOnly = readNotes({ type: "tried" });
    expect(triedOnly.length).toBe(2);
    expect(triedOnly.every((n) => n.type === "tried")).toBeTrue();
  });

  it("compactNotes removes old notes, preserves recent ones, and logs note:archived events", () => {
    const now = Date.now();
    const oldTs = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const recentTs = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

    const pathToNotes = notesPath();
    const lines = [
      JSON.stringify({
        ts: oldTs,
        type: "warning",
        message: "old note",
        actor: "user",
      }),
      JSON.stringify({
        ts: recentTs,
        type: "discovered",
        message: "recent note",
        actor: "user",
      }),
    ];
    fs.writeFileSync(pathToNotes, `${lines.join("\n")}\n`, "utf-8");

    const archivedCount = compactNotes(30);
    expect(archivedCount).toBe(1);

    const remaining = safeReadNdjson<{ message: string }>(pathToNotes);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.message).toBe("recent note");

    const logEntries = safeReadNdjson<{ event: string }>(logsPath());
    const archivedEvents = logEntries.filter((e) => e.event === "note:archived");
    expect(archivedEvents.length).toBeGreaterThanOrEqual(1);
  });
});

