import type { SpecDiff, DriftState, DriftItem } from "../lib/signals.js";
import { createDriftId } from "../lib/signals.js";
import { readDrift, writeDrift } from "../lib/files.js";
import { log } from "../lib/logger.js";

export function computeDrift(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
} {
  const existing = readDrift();
  const newItems: DriftItem[] = [];

  const existingFingerprints = new Set(existing.items.map((item) => fingerprint(item)));

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

  // Automatically resolve drift items whose underlying fingerprint is no longer present.
  for (const item of existing.items) {
    const fp = fingerprint(item);
    if (item.status === "unresolved" && !currentFingerprints.has(fp)) {
      item.status = "rejected";
      log({
        event: "drift:resolved",
        system: item.system ?? item.risk ?? item.type,
        message: item.signal,
        source: ".tack/_drift.yaml",
      });
    }
  }

  for (const violation of diff.violations) {
    const item: DriftItem = {
      id: createDriftId(),
      type: violation.type === "forbidden_system" ? "forbidden_system_detected" : "constraint_mismatch",
      system: violation.signal.id,
      signal: `${violation.signal.detail ?? violation.signal.id}: ${violation.signal.source}`,
      detected: new Date().toISOString(),
      status: "unresolved",
    };

    if (!existingFingerprints.has(fingerprint(item))) {
      newItems.push(item);
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

    if (!existingFingerprints.has(fingerprint(item))) {
      newItems.push(item);
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

    if (!existingFingerprints.has(fingerprint(item))) {
      newItems.push(item);
    }
  }

  const state: DriftState = {
    items: [...existing.items, ...newItems],
  };

  writeDrift(state);

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
  const state = readDrift();
  const item = state.items.find((i) => i.id === id);
  let previousStatus: DriftItem["status"] | null = null;
  if (item) {
    previousStatus = item.status;
    item.status = action === "skipped" ? "unresolved" : action;
    if (note) item.note = note;
  }
  writeDrift(state);
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
