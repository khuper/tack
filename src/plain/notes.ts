import type { AgentNoteType } from "../lib/signals.js";
import { AGENT_NOTE_TYPES } from "../lib/signals.js";
import { readNotes, addNote, formatRelativeTime } from "../lib/notes.js";

function isValidNoteType(value: string): value is AgentNoteType {
  return (AGENT_NOTE_TYPES as readonly string[]).includes(value);
}

export function printNotes(opts?: { limit?: number; type?: string }): boolean {
  const limit = opts?.limit;
  const rawType = opts?.type;

  let typeFilter: AgentNoteType | undefined;
  if (typeof rawType === "string") {
    if (!isValidNoteType(rawType)) {
      // eslint-disable-next-line no-console
      console.error(
        `Unknown note type: "${rawType}". Allowed types: ${AGENT_NOTE_TYPES.join(", ")}.`
      );
      return false;
    }
    typeFilter = rawType;
  }

  const notes = readNotes({ limit, type: typeFilter });
  if (!notes.length) {
    // eslint-disable-next-line no-console
    console.log("No agent notes recorded.");
    return true;
  }

  for (const note of notes) {
    const ago = formatRelativeTime(note.ts);
    const actor = note.actor || "unknown";
    // eslint-disable-next-line no-console
    console.log(`[${note.type}] ${ago} — ${note.message} (${actor})`);
  }
  return true;
}

export function addNotePlain(type: string, message: string, actor?: string): boolean {
  const normalizedActor = actor ?? "user";

  if (!isValidNoteType(type)) {
    // eslint-disable-next-line no-console
    console.error(
      `Unknown note type: "${type}". Allowed types: ${AGENT_NOTE_TYPES.join(", ")}.`
    );
    return false;
  }

  const ok = addNote({
    type,
    message,
    actor: normalizedActor,
    related_files: undefined,
  });

  if (!ok) {
    // eslint-disable-next-line no-console
    console.error("Failed to add note. See _logs.ndjson for details.");
  }

  return ok;
}

