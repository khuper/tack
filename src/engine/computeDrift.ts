import type { SpecDiff, DriftState, DriftItem } from "../lib/signals.js";
import { createDriftId } from "../lib/signals.js";
import { quarantineCorruptDrift, readDriftWithError, writeDrift } from "../lib/files.js";
import { DRIFT_STATUS_DISAPPEARED, asDriftItemStatus, isDisappearedDriftItem } from "../lib/validate.js";
import { log } from "../lib/logger.js";

export function computeDrift(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
} {
  const { state: existing, error: readError } = readDriftWithError();

  // A torn `_drift.yaml` (merge-conflict markers are enough: the file is committed to git)
  // reads as an empty state. Persisting on top of that would erase every accepted and
  // rejected resolution, so copy the file aside and run this sweep read-only instead.
  if (readError) {
    const backup = quarantineCorruptDrift();
    // eslint-disable-next-line no-console
    console.warn(
      `[tack] _drift.yaml could not be read, so drift state was NOT updated: ${readError}. ` +
        (backup ? `A copy of the unreadable file is at ${backup}. ` : "") +
        "Fix or delete .tack/_drift.yaml and re-run; until then accepted/rejected resolutions are not visible."
    );
  }

  const appendedItems: DriftItem[] = [];
  const reopenedItems: DriftItem[] = [];

  // Build the set of drift fingerprints that are still present in the latest spec diff.
  const currentFingerprints = new Set<string>();

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
    currentFingerprints.add(fingerprint(fpItem));
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
    currentFingerprints.add(fingerprint(fpItem));
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
    currentFingerprints.add(fingerprint(fpItem));
  }

  // Reopen items that Tack auto-dismissed earlier and that have now come back. A
  // violation removed in one commit and reintroduced in the next has to surface again.
  for (const item of existing.items) {
    if (!isDisappearedDriftItem(item)) continue;
    if (!currentFingerprints.has(fingerprint(item))) continue;
    item.status = "unresolved";
    item.detected = new Date().toISOString();
    reopenedItems.push(item);
  }

  // Auto-dismiss drift items whose underlying fingerprint is no longer present. This is a
  // machine observation, not a human verdict, so it uses its own status: reusing
  // "rejected" here would make the item indistinguishable from one a person dismissed and
  // suppress it forever.
  for (const item of existing.items) {
    const fp = fingerprint(item);
    if (item.status === "unresolved" && !currentFingerprints.has(fp)) {
      item.status = asDriftItemStatus(DRIFT_STATUS_DISAPPEARED);
      log({
        event: "drift:resolved",
        system: item.system ?? item.risk ?? item.type,
        message: item.signal,
        source: ".tack/_drift.yaml",
      });
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

  for (const item of newItems) {
    log({
      event: "drift:detected",
      system: item.system ?? item.risk ?? item.type,
      message: item.signal,
      source: ".tack/_drift.yaml",
    });
  }

  return { newItems, state };
}

export function resolveDriftItem(
  id: string,
  action: "accepted" | "rejected" | "skipped",
  note?: string
): DriftState {
  const { state, error: readError } = readDriftWithError();
  const item = state.items.find((i) => i.id === id);
  let previousStatus: DriftItem["status"] | null = null;
  if (item) {
    previousStatus = item.status;
    item.status = action === "skipped" ? "unresolved" : action;
    if (note) item.note = note;
  }
  // Same rule as computeDrift: never persist on top of a state that failed to load.
  if (!readError) {
    writeDrift(state);
  }
  if (item && previousStatus === "unresolved" && item.status !== "unresolved") {
    log({
      event: "drift:resolved",
      system: item.system ?? item.risk ?? item.type,
      message: item.signal,
      source: ".tack/_drift.yaml",
    });
  }
  return state;
}

function fingerprint(item: DriftItem): string {
  return `${item.type}:${item.system ?? ""}:${item.risk ?? ""}`;
}
