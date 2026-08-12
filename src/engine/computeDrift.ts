import type { SpecDiff, DriftState, DriftItem } from "../lib/signals.js";
import { createDriftId, DRIFT_SCHEMA_VERSION } from "../lib/signals.js";
import { quarantineCorruptDrift, readDriftWithError, readSpec, writeDrift, writeSpec } from "../lib/files.js";
import { DRIFT_STATUS_DISAPPEARED, isDisappearedDriftItem } from "../lib/validate.js";
import { log } from "../lib/logger.js";

let warnedDriftReadOnly = false;

export function computeDrift(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
  /** True when `_drift.yaml` failed to load and this sweep neither persisted nor should re-alert. */
  readOnly: boolean;
} {
  const { state: existing, error: readError } = readDriftWithError();

  // A successful read ends the current failure episode, so a LATER corruption warns
  // again: the once-guard is per episode, not per process lifetime — a watch session
  // that sees the file repaired and then re-corrupted must not go silent.
  if (readError === null) {
    warnedDriftReadOnly = false;
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
  // Order: claim the verdict FIRST, then update the spec. Claiming is the only step
  // with a conflict check (compare-and-set on `unresolved`), so doing it first means a
  // racing process cannot write the opposite architecture rule after we have committed
  // ours. If the spec step then fails, the claim is rolled back to `unresolved` so the
  // item stays actionable and the two files never contradict each other.
  const claim = resolveDriftItem(
    item.id,
    action,
    action === "accepted" ? "Accepted via tack watch" : "Rejected via tack watch"
  );
  if (!claim.persisted) {
    return {
      persisted: false,
      specUpdated: false,
      error:
        claim.failedStage === "write"
          ? "drift_write_failed"
          : claim.failedStage === "conflict"
            ? "item_stale"
            : "drift_unreadable",
    };
  }

  if (!item.system) {
    return { persisted: true, specUpdated: false, error: null };
  }

  const rollback = (): void => {
    // Best-effort: restore the item so the alert can be retried after the operator
    // fixes spec.yaml. A failure here leaves the verdict recorded without the rule,
    // which the caller still reports as a spec failure.
    const current = readDriftWithError();
    if (current.error) return;
    const stored = current.state.items.find((candidate) => candidate.id === item.id);
    if (!stored) return;
    stored.status = "unresolved";
    delete stored.note;
    try {
      writeDrift(current.state);
    } catch {
      // Nothing further to do; the outcome already reports the spec failure.
    }
  };

  const spec = readSpec();
  if (!spec) {
    rollback();
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
    rollback();
    return { persisted: false, specUpdated: false, error: "spec_write_failed" };
  }

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
  failedStage?: "read" | "write" | "conflict";
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
  let previousStatus: DriftItem["status"] | null = null;
  if (item) {
    previousStatus = item.status;
    // Last-moment conflict check: callers verified the item was unresolved before
    // doing their own work (e.g. writing spec.yaml), but another watch process can
    // record a verdict in the window between that check and this write. Overwriting
    // it would leave the drift state contradicting the spec, so the loser of the
    // race reports a conflict instead.
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
  }
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
  if (item && previousStatus === "unresolved" && item.status !== "unresolved") {
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
