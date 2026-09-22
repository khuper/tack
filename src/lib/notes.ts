import { readFileSync } from "node:fs";
import { appendSafe, notesPath, writeSafe } from "./files.js";
import { safeReadNdjson } from "./ndjson.js";
import { log } from "./logger.js";
import type { AgentNote, AgentNoteType } from "./signals.js";
import { AGENT_NOTE_TYPES } from "./signals.js";

const MAX_MESSAGE_LENGTH = 500;

function isValidNoteType(value: string): value is AgentNoteType {
  return (AGENT_NOTE_TYPES as readonly string[]).includes(value);
}

function sanitizeMessage(input: string): string {
  const text = String(input);
  const withoutControl = text.replace(/[\r\n\t\x00-\x1f]/g, " ");
  const collapsed = withoutControl.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, MAX_MESSAGE_LENGTH);
}

// Append a note to _notes.ndjson
// - Validate type is one of the allowed enums
// - Truncate message to 500 chars
// - Strip newlines and control characters from message
// - Create _notes.ndjson if it doesn't exist
// - Also emit a "note:added" event to _logs.ndjson via the existing logger
export function addNote(note: Omit<AgentNote, "ts">): boolean {
  const type = note.type;
  if (!isValidNoteType(type)) {
    return false;
  }

  const message = sanitizeMessage(note.message);
  if (!message) {
    return false;
  }

  const actor =
    typeof note.actor === "string" && note.actor.trim().length > 0 ? note.actor.trim() : "user";

  const entry: AgentNote = {
    ts: new Date().toISOString(),
    type,
    message,
    related_files: note.related_files,
    actor,
  };

  try {
    appendSafe(notesPath(), `${JSON.stringify(entry)}\n`);
  } catch {
    return false;
  }

  try {
    log({ event: "note:added", type: entry.type, actor: entry.actor });
  } catch {
    // Logging failures should not break note writes
  }

  return true;
}

// Read notes, most recent first
// - Return empty array if file doesn't exist
// - Skip corrupt lines (partial writes)
// - Optional limit param, default 20
// - Optional type filter
export function readNotes(opts?: { limit?: number; type?: AgentNoteType }): AgentNote[] {
  const all = safeReadNdjson<AgentNote>(notesPath());
  if (!all.length) return [];

  const byType = opts?.type ? all.filter((n) => n.type === opts.type) : all;

  const sorted = [...byType].sort((a, b) => {
    const at = a.ts ?? "";
    const bt = b.ts ?? "";
    if (at === bt) return 0;
    return at < bt ? 1 : -1; // newer first
  });

  const limit = opts?.limit ?? 20;
  if (!limit || limit < 0) return sorted;
  return sorted.slice(0, limit);
}

export function formatRelativeTime(fromIso: string, toIso?: string): string {
  const fromMsRaw = Date.parse(fromIso);
  const toMsRaw = toIso ? Date.parse(toIso) : Date.now();
  if (!Number.isFinite(fromMsRaw) || !Number.isFinite(toMsRaw)) return "unknown time";

  const toMs = toMsRaw;
  const fromMs = Math.min(fromMsRaw, toMs);

  const diffMs = toMs - fromMs;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const date = new Date(fromMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Clear notes older than N days
// - Used during compaction
// - Moves old notes to _logs.ndjson as "note:archived" events
// - Rewrites _notes.ndjson with only recent notes
export function compactNotes(maxAgeDays?: number): number {
  const days = maxAgeDays ?? 30;
  if (days <= 0) return 0;

  let raw: string;
  try {
    raw = readFileSync(notesPath(), "utf-8");
  } catch {
    return 0;
  }

  const now = Date.now();
  const thresholdMs = days * 24 * 60 * 60 * 1000;

  // Work on the raw lines, not the parsed subset: a line that does not parse (a torn
  // append from a concurrent writer, a hand edit) is kept verbatim rather than erased,
  // and lines that stay are written back byte-for-byte.
  const kept: string[] = [];
  const archived: AgentNote[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let note: AgentNote | null = null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof (parsed as AgentNote).ts === "string") {
        note = parsed as AgentNote;
      }
    } catch {
      note = null;
    }
    const ts = note ? new Date(note.ts).getTime() : Number.NaN;
    if (!note || !Number.isFinite(ts) || now - ts < thresholdMs) {
      kept.push(line);
      continue;
    }
    archived.push(note);
  }

  // Nothing to archive means nothing to rewrite: the file stays untouched.
  if (archived.length === 0) return 0;

  try {
    writeSafe(notesPath(), kept.length === 0 ? "" : `${kept.join("\n")}\n`);
  } catch {
    // The rewrite failed, so nothing was archived; the file is as it was.
    return 0;
  }

  for (const note of archived) {
    try {
      log({ event: "note:archived", type: note.type, actor: note.actor });
    } catch {
      // Ignore logging failures during compaction
    }
  }

  return archived.length;
}

