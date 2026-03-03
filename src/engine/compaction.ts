import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import * as path from "node:path";
import { handoffsDirPath } from "../lib/files.js";
import { log } from "../lib/logger.js";

/**
 * Archives handoff pairs (`.json` + `.md`) older than the most recent `keepRecent`.
 * Moves them into `.tack/handoffs/archive/` so pairs are never split.
 */
export function archiveOldHandoffs(keepRecent = 10): void {
  const handoffsDir = handoffsDirPath();
  if (!existsSync(handoffsDir)) return;

  const entries = readdirSync(handoffsDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md")))
    .map((e) => e.name);

  // Group by stem (basename without extension) so we keep/archive whole pairs
  const byStem = new Map<string, string[]>();
  for (const f of files) {
    const stem = path.basename(f, path.extname(f));
    const list = byStem.get(stem) ?? [];
    list.push(f);
    byStem.set(stem, list);
  }

  const stems = Array.from(byStem.keys()).sort().reverse();
  const toKeep = stems.slice(0, keepRecent);
  const toArchive = stems.slice(keepRecent);
  if (toArchive.length === 0) return;

  const archiveDir = path.join(handoffsDir, "archive");
  mkdirSync(archiveDir, { recursive: true });

  let archivedCount = 0;
  for (const stem of toArchive) {
    for (const file of byStem.get(stem) ?? []) {
      renameSync(path.join(handoffsDir, file), path.join(archiveDir, file));
      archivedCount++;
    }
  }

  log({
    event: "compaction:archive_handoffs",
    archived_count: archivedCount,
    kept_count: toKeep.length,
  });
}
