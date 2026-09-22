import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import * as path from "node:path";
import { assertNotSymlinkStrict, handoffsDirPath } from "../lib/files.js";
import { log } from "../lib/logger.js";

const HANDOFF_TIMESTAMP_SUFFIX = /(?:^|_)(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function handoffSortKey(handoffsDir: string, byStem: Map<string, string[]>, stem: string): number {
  const match = stem.match(HANDOFF_TIMESTAMP_SUFFIX);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  }
  let newest = 0;
  for (const file of byStem.get(stem) ?? []) {
    try {
      newest = Math.max(newest, statSync(path.join(handoffsDir, file)).mtimeMs);
    } catch {
      // A file that vanished mid-listing sorts as oldest.
    }
  }
  return newest;
}

/**
 * Archives handoff pairs (`.json` + `.md`) older than the most recent `keepRecent`.
 * Moves them into `.tack/handoffs/archive/` so pairs are never split.
 */
export function archiveOldHandoffs(keepRecent = 10): void {
  const handoffsDir = handoffsDirPath();
  // Rename moves files through directory links wherever they point (even inside the
  // repo: `archive -> ../..` plus an old README.md handoff stem would overwrite the
  // real README), so both directories must be real, not merely in-project.
  assertNotSymlinkStrict(handoffsDir);
  if (!existsSync(handoffsDir)) return;

  const entries = readdirSync(handoffsDir, { withFileTypes: true });
  // `isFile()` is lstat-based, so symlinked handoff entries are skipped rather than moved.
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

  // Stems are `<branch-slug>_<YYYYMMDDTHHMMSSZ>`, so a plain sort orders by branch label
  // and archives the newest handoffs of any branch that sorts below an older one. Order
  // by the timestamp segment (newest first); a stem without one falls back to mtime.
  const stems = Array.from(byStem.keys()).sort((a, b) => {
    const diff = handoffSortKey(handoffsDir, byStem, b) - handoffSortKey(handoffsDir, byStem, a);
    return diff !== 0 ? diff : b.localeCompare(a);
  });
  const toKeep = stems.slice(0, keepRecent);
  const toArchive = stems.slice(keepRecent);
  if (toArchive.length === 0) return;

  const archiveDir = path.join(handoffsDir, "archive");
  assertNotSymlinkStrict(archiveDir);
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
