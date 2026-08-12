import type { SpecDiff, DriftState, DriftItem } from "../lib/signals.js";
import { createDriftId, DRIFT_SCHEMA_VERSION } from "../lib/signals.js";
import {
  clearDriftClaimJournal,
  quarantineCorruptDrift,
  readDriftClaimJournal,
  readDriftWithError,
  readSpec,
  withDriftLock,
  writeDrift,
  writeDriftClaimJournal,
  writeSpec,
} from "../lib/files.js";
import { DRIFT_STATUS_DISAPPEARED, isDisappearedDriftItem } from "../lib/validate.js";
import { log } from "../lib/logger.js";

let warnedDriftReadOnly = false;
let warnedDriftWriteFailure = false;

export function computeDrift(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
  /** True when `_drift.yaml` failed to load and this sweep neither persisted nor should re-alert. */
  readOnly: boolean;
} {
  // The whole scan (read -> reopen/dismiss -> append -> write) runs under the state
  // lock, so a resolution recorded by another watch process cannot be overwritten by
  // this scan's stale snapshot. If the lock is unavailable the scan degrades to a
  // read-only sweep rather than crashing the watch loop or racing the writer.
  try {
    return withDriftLock(() => computeDriftLocked(diff));
  } catch (err) {
    // Lock contention is expected and silent: another Tack process owns the state
    // right now, and the next scan will pick it up. A PERSISTENCE failure (full disk,
    // read-only directory, blocked write) is not expected and must be reported, or
    // watch would silently stop surfacing drift with no explanation.
    const isLockContention = err instanceof Error && err.message.includes("Timed out waiting for");
    if (!isLockContention && !warnedDriftWriteFailure) {
      warnedDriftWriteFailure = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[tack] drift state could not be saved: ${err instanceof Error ? err.message : String(err)}. ` +
          "Scans continue read-only; new drift is not being recorded until this is fixed."
      );
    }
    const { state } = readDriftWithError();
    return { newItems: [], state, readOnly: true };
  }
}

/**
 * Repairs a verdict that was persisted to `_drift.yaml` while its `spec.yaml` rule was
 * never applied — the state a process killed mid-transaction leaves behind. The verdict
 * is reverted to `unresolved` so the item alerts again and the operator can redo it;
 * silently keeping it would suppress the alert forever while the architecture rule the
 * verdict was supposed to create is missing. Runs under the state lock.
 */
function reconcileInterruptedClaim(): void {
  const journal = readDriftClaimJournal();
  if (!journal) return;

  const { state, error } = readDriftWithError();
  if (error) return; // Unreadable state: the read-only path already warns.

  // The journal alone does not prove the spec write was missed — the process may have
  // died after writeSpec succeeded but before the journal was cleared. Check the spec
  // itself: if the rule is already there, the transaction DID complete and the verdict
  // must be kept.
  const spec = readSpec();
  if (!spec) return; // Cannot verify; leave the journal for a later scan.
  const ruleLanded =
    journal.action === "accepted"
      ? spec.allowed_systems.includes(journal.system)
      : spec.forbidden_systems.includes(journal.system);
  if (ruleLanded) {
    clearDriftClaimJournal();
    return;
  }

  const item = state.items.find((candidate) => candidate.id === journal.itemId);
  if (item && item.status === journal.action) {
    item.status = "unresolved";
    delete item.note;
    try {
      writeDrift(state);
    } catch {
      return; // Keep the journal so a later scan can retry the repair.
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[tack] a previous "${journal.action}" on drift item ${journal.itemId} did not finish ` +
        "(spec.yaml was never updated), so it was reset to unresolved and will alert again."
    );
  }
  clearDriftClaimJournal();
}

function computeDriftLocked(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
  readOnly: boolean;
} {
  reconcileInterruptedClaim();
  const { state: existing, error: readError } = readDriftWithError();

  // A successful read ends the current failure episode, so a LATER corruption warns
  // again: the once-guard is per episode, not per process lifetime — a watch session
  // that sees the file repaired and then re-corrupted must not go silent.
  if (readError === null) {
    warnedDriftReadOnly = false;
    warnedDriftWriteFailure = false;
  }

  // A torn `_drift.yaml` (merge-conflict markers are enough: the file is committed to git)
  // reads as an empty state. Persisting on top of that would erase every accepted and
  // rejected resolution, so copy the file aside and run this sweep read-only instead.
  // The watch loop calls this on every scan, so warn once per failure episode.
  if (readError && !warnedDriftReadOnly) {
    warnedDriftReadOnly = true;
    const backup = quarantineCorruptDrift();
    // eslint-disable-next-line no-console
    console.warn(
      `[tack] _drift.yaml could not be used, so drift state was NOT updated: ${readError}. ` +
        (backup
          ? `A copy of the original file is at ${backup}. Fix or delete .tack/_drift.yaml and re-run; ` +
            "until then accepted/rejected resolutions are not visible."
          : "No backup could be created — do NOT delete .tack/_drift.yaml; copy it somewhere safe " +
            "manually, then repair it. Until then accepted/rejected resolutions are not visible.")
    );
  }

  // One-time migration, gated on the file's schema version: Tack versions before the
  // `disappeared` status (schema_version < 2, i.e. no version field) auto-dismissed
  // items as `rejected` with no note, which the code below would treat as a permanent
  // human verdict. The TUI always attaches a note to human rejections, so on legacy
  // files a note-less rejection is overwhelmingly a machine dismissal and becomes
  // `disappeared`, eligible to reopen if its violation comes back. Files written by
  // this version (schema_version >= 2) are never migrated: a note-less `rejected`
  // there is a deliberate verdict (hand-edited or via the API) and is preserved.
  // Never on a read-only sweep: an unusable schema_version reads as "unversioned",
  // and migrating in memory would misreport statuses the file still holds.
  if (readError === null && (existing.schema_version ?? 1) < DRIFT_SCHEMA_VERSION) {
    for (const item of existing.items) {
      if (item.status === "rejected" && !item.note) {
        item.status = DRIFT_STATUS_DISAPPEARED;
      }
    }
  }

  const appendedItems: DriftItem[] = [];
  const reopenedItems: DriftItem[] = [];

  // Build the set of drift fingerprints that are still present in the latest spec diff,
  // remembering the current signal text so a reopened item can be re-anchored to where
  // the violation lives now (the fingerprint ignores the source file, so a violation
  // reintroduced elsewhere must not keep pointing at its original location).
  const currentFingerprints = new Set<string>();
  const currentSignals = new Map<string, string>();

  for (const violation of diff.violations) {
    const type =
      violation.type === "forbidden_system" ? "forbidden_system_detected" : "constraint_mismatch";
    const fpItem: DriftItem = {
      id: "",
      type,
      system: violation.signal.id,
      signal: "",
      detected: "",
      status: "unresolved",
    };
    const fp = fingerprint(fpItem);
    currentFingerprints.add(fp);
    currentSignals.set(fp, `${violation.signal.detail ?? violation.signal.id}: ${violation.signal.source}`);
  }

  for (const risk of diff.risks) {
    const fpItem: DriftItem = {
      id: "",
      type: "risk",
      risk: risk.id,
      signal: "",
      detected: "",
      status: "unresolved",
    };
    const fp = fingerprint(fpItem);
    currentFingerprints.add(fp);
    currentSignals.set(fp, `${risk.detail ?? risk.id}: ${risk.source}`);
  }

  for (const sig of diff.undeclared) {
    const fpItem: DriftItem = {
      id: "",
      type: "undeclared_system",
      system: sig.id,
      signal: "",
      detected: "",
      status: "unresolved",
    };
    const fp = fingerprint(fpItem);
    currentFingerprints.add(fp);
    currentSignals.set(fp, `${sig.detail ?? sig.id}: ${sig.source}`);
  }

  // Reopen items that Tack auto-dismissed earlier and that have now come back. A
  // violation removed in one commit and reintroduced in the next has to surface again.
  for (const item of existing.items) {
    if (!isDisappearedDriftItem(item)) continue;
    const fp = fingerprint(item);
    if (!currentFingerprints.has(fp)) continue;
    item.status = "unresolved";
    item.detected = new Date().toISOString();
    item.signal = currentSignals.get(fp) ?? item.signal;
    reopenedItems.push(item);
  }

  // Auto-dismiss drift items whose underlying fingerprint is no longer present. This is a
  // machine observation, not a human verdict, so it uses its own status: reusing
  // "rejected" here would make the item indistinguishable from one a person dismissed and
  // suppress it forever.
  for (const item of existing.items) {
    const fp = fingerprint(item);
    if (item.status === "unresolved" && !currentFingerprints.has(fp)) {
      item.status = DRIFT_STATUS_DISAPPEARED;
      // Read-only sweeps skip the log: the dismissal is not persisted, so the next scan
      // would re-dismiss and re-log the same items indefinitely.
      if (!readError) {
        log({
          event: "drift:resolved",
          system: item.system ?? item.risk ?? item.type,
          message: item.signal,
          source: ".tack/_drift.yaml",
        });
      }
    }
  }

  // Only items that are still open or that a person ruled on suppress a fresh detection.
  // Auto-dismissed items are handled by the reopen pass above.
  const suppressedFingerprints = new Set(
    existing.items.filter((item) => !isDisappearedDriftItem(item)).map((item) => fingerprint(item))
  );

  for (const violation of diff.violations) {
    const item: DriftItem = {
      id: createDriftId(),
      type: violation.type === "forbidden_system" ? "forbidden_system_detected" : "constraint_mismatch",
      system: violation.signal.id,
      signal: `${violation.signal.detail ?? violation.signal.id}: ${violation.signal.source}`,
      detected: new Date().toISOString(),
      status: "unresolved",
    };

    if (!suppressedFingerprints.has(fingerprint(item))) {
      appendedItems.push(item);
    }
  }

  for (const risk of diff.risks) {
    const item: DriftItem = {
      id: createDriftId(),
      type: "risk",
      risk: risk.id,
      signal: `${risk.detail ?? risk.id}: ${risk.source}`,
      detected: new Date().toISOString(),
      status: "unresolved",
    };

    if (!suppressedFingerprints.has(fingerprint(item))) {
      appendedItems.push(item);
    }
  }

  for (const sig of diff.undeclared) {
    const item: DriftItem = {
      id: createDriftId(),
      type: "undeclared_system",
      system: sig.id,
      signal: `${sig.detail ?? sig.id}: ${sig.source}`,
      detected: new Date().toISOString(),
      status: "unresolved",
    };

    if (!suppressedFingerprints.has(fingerprint(item))) {
      appendedItems.push(item);
    }
  }

  const state: DriftState = {
    items: [...existing.items, ...appendedItems],
  };

  if (!readError) {
    writeDrift(state);
  }

  // Reopened items are new to the operator even though they already have an id.
  const newItems = [...reopenedItems, ...appendedItems];

  // Same read-only rule as above: unpersisted items would be re-detected and re-logged
  // on every scan.
  if (!readError) {
    for (const item of newItems) {
      log({
        event: "drift:detected",
        system: item.system ?? item.risk ?? item.type,
        message: item.signal,
        source: ".tack/_drift.yaml",
      });
    }
  }

  return { newItems, state, readOnly: readError !== null };
}

export type DriftResolutionOutcome = {
  /** True when the drift verdict is stored in _drift.yaml. */
  persisted: boolean;
  /** True when spec.yaml was modified (accept/deny of a system item). */
  specUpdated: boolean;
  /** Names the failing stage so the UI can say exactly what did and didn't happen. */
  error:
    | "spec_unreadable"
    | "spec_write_failed"
    | "drift_unreadable"
    | "drift_write_failed"
    | "item_stale"
    | null;
};

/**
 * The full accept/deny transaction: update spec.yaml FIRST, then persist the drift
 * verdict. This ordering makes every failure mode recoverable — if the spec step
 * fails nothing has happened, and if the drift step fails the spec rule is already
 * recorded, the item stays unresolved, and a retry is idempotent (re-adding an
 * already-present system is a no-op). The reverse order would store a permanent
 * human verdict while losing the architecture rule it was supposed to create.
 */
export function resolveDriftItemWithSpec(
  item: DriftItem,
  action: "accepted" | "rejected"
): DriftResolutionOutcome {
  // The claim AND the spec read/write happen under one lock hold, so two processes
  // resolving DIFFERENT items cannot both read the same spec and have the last write
  // drop the other's rule. The lock is re-entrant, so the nested claim below reuses it.
  return withDriftLockOrFailure(() => resolveDriftItemWithSpecLocked(item, action));
}

function withDriftLockOrFailure(fn: () => DriftResolutionOutcome): DriftResolutionOutcome {
  try {
    return withDriftLock(fn);
  } catch {
    return { persisted: false, specUpdated: false, error: "drift_write_failed" };
  }
}

function resolveDriftItemWithSpecLocked(
  item: DriftItem,
  action: "accepted" | "rejected"
): DriftResolutionOutcome {
  // Order: claim the verdict FIRST, then update the spec. Claiming is the only step
  // with a conflict check (compare-and-set on `unresolved`), so doing it first means a
  // racing process cannot write the opposite architecture rule after we have committed
  // ours. If the spec step then fails, the claim is rolled back to `unresolved` so the
  // item stays actionable and the two files never contradict each other.
  // Record the intent BEFORE the claim: if this process dies between persisting the
  // verdict and writing the spec rule, the next scan finds this marker and resets the
  // item so it alerts again instead of being suppressed with no rule to show for it.
  if (item.system) {
    try {
      writeDriftClaimJournal({ itemId: item.id, action, system: item.system });
    } catch {
      return { persisted: false, specUpdated: false, error: "drift_write_failed" };
    }
  }

  const claim = resolveDriftItem(
    item.id,
    action,
    action === "accepted" ? "Accepted via tack watch" : "Rejected via tack watch"
  );
  if (!claim.persisted) {
    clearDriftClaimJournal();
    return {
      persisted: false,
      specUpdated: false,
      error:
        claim.failedStage === "write" || claim.failedStage === "lock"
          ? "drift_write_failed"
          : claim.failedStage === "conflict"
            ? "item_stale"
            : "drift_unreadable",
    };
  }

  if (!item.system) {
    return { persisted: true, specUpdated: false, error: null };
  }

  /**
   * Restores the item so the alert can be retried after the operator fixes spec.yaml.
   * Returns false when the verdict could NOT be un-recorded — in that case the claim
   * journal must be kept, because it is the only marker that will let a later scan
   * repair the half-applied transaction.
   */
  const rollback = (): boolean => {
    const current = readDriftWithError();
    if (current.error) return false;
    const stored = current.state.items.find((candidate) => candidate.id === item.id);
    if (!stored) return true; // Nothing recorded to undo.
    stored.status = "unresolved";
    delete stored.note;
    try {
      writeDrift(current.state);
      return true;
    } catch {
      return false;
    }
  };

  const spec = readSpec();
  if (!spec) {
    if (rollback()) clearDriftClaimJournal();
    return { persisted: false, specUpdated: false, error: "spec_unreadable" };
  }

  let specUpdated = false;
  if (action === "accepted") {
    if (!spec.allowed_systems.includes(item.system)) {
      spec.allowed_systems.push(item.system);
      specUpdated = true;
    }
    const forbiddenBefore = spec.forbidden_systems.length;
    spec.forbidden_systems = spec.forbidden_systems.filter((s) => s !== item.system);
    specUpdated = specUpdated || spec.forbidden_systems.length !== forbiddenBefore;
  } else {
    if (!spec.forbidden_systems.includes(item.system)) {
      spec.forbidden_systems.push(item.system);
      specUpdated = true;
    }
    const allowedBefore = spec.allowed_systems.length;
    spec.allowed_systems = spec.allowed_systems.filter((s) => s !== item.system);
    specUpdated = specUpdated || spec.allowed_systems.length !== allowedBefore;
  }

  try {
    writeSpec(spec);
  } catch {
    if (rollback()) clearDriftClaimJournal();
    return { persisted: false, specUpdated: false, error: "spec_write_failed" };
  }
  // Both halves are on disk: the transaction is complete.
  clearDriftClaimJournal();

  if (specUpdated) {
    log({
      event: "spec:updated",
      field: action === "accepted" ? "allowed_systems" : "forbidden_systems",
      diff: `added ${item.system}`,
    });
  }

  return { persisted: true, specUpdated, error: null };
}

export function resolveDriftItem(
  id: string,
  action: "accepted" | "rejected" | "skipped",
  note?: string
): {
  state: DriftState;
  persisted: boolean;
  error: string | null;
  failedStage?: "read" | "write" | "conflict" | "lock";
} {
  try {
    return withDriftLock(() => applyDriftResolution(id, action, note));
  } catch (err) {
    // Failing to take the lock (another Tack process is mid-transaction, or the lock
    // file itself is unwritable) must surface as an unpersisted outcome like every
    // other failure here — never as an exception unwinding through the Ink UI.
    const { state } = readDriftWithError();
    return {
      state,
      persisted: false,
      error: err instanceof Error ? err.message : String(err),
      failedStage: "lock",
    };
  }
}

/**
 * The locked read-modify-write. Every step — the read, the conflict check and the
 * write — happens while this process holds the drift lock, so a concurrent watch
 * process cannot interleave between the check and the write.
 */
function applyDriftResolution(
  id: string,
  action: "accepted" | "rejected" | "skipped",
  note?: string
): {
  state: DriftState;
  persisted: boolean;
  error: string | null;
  failedStage?: "read" | "write" | "conflict" | "lock";
} {
  const { state, error: readError } = readDriftWithError();

  // Same rule as computeDrift: never persist on top of a state that failed to load.
  // The verdict is not applied even in memory and nothing is logged — the caller
  // must be able to tell the user their resolution was NOT recorded, instead of
  // showing success while the file stays unreadable.
  if (readError) {
    return { state, persisted: false, error: readError, failedStage: "read" };
  }

  const item = state.items.find((i) => i.id === id);
  // The alert's item is gone entirely (the operator repaired or replaced the file):
  // there is nothing to resolve, and callers must not act on a stale alert.
  if (!item) {
    return {
      state,
      persisted: false,
      error: `drift item ${id} is no longer present in _drift.yaml`,
      failedStage: "conflict",
    };
  }
  const previousStatus: DriftItem["status"] = item.status;
  // Conflict check inside the lock: another process may have recorded a verdict
  // between the caller queuing this alert and now. Overwriting it would leave the
  // drift state contradicting spec.yaml, so the loser reports a conflict instead.
  if (action !== "skipped" && item.status !== "unresolved") {
    return {
      state,
      persisted: false,
      error: `drift item ${id} was already resolved as "${item.status}" by another process`,
      failedStage: "conflict",
    };
  }
  // Skip means "leave the item as it is" — it must never overwrite a status a
  // concurrent process set in the meantime (reverting an accepted/rejected/
  // disappeared item to unresolved would undo a verdict without any notice).
  if (action !== "skipped") {
    item.status = action;
  }
  if (note) item.note = note;
  // A readable file can still be unwritable (disk full, directory permissions, a
  // symlink the write boundary rejects). That must surface as an unpersisted
  // outcome, not an exception that unwinds through the UI mid-transaction.
  try {
    writeDrift(state);
  } catch (err) {
    return {
      state,
      persisted: false,
      error: err instanceof Error ? err.message : String(err),
      failedStage: "write",
    };
  }
  if (previousStatus === "unresolved" && item.status !== "unresolved") {
    log({
      event: "drift:resolved",
      system: item.system ?? item.risk ?? item.type,
      message: item.signal,
      source: ".tack/_drift.yaml",
    });
  }
  return { state, persisted: true, error: null };
}

function fingerprint(item: DriftItem): string {
  return `${item.type}:${item.system ?? ""}:${item.risk ?? ""}`;
}
