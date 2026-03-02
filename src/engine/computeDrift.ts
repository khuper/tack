import type { SpecDiff, DriftState, DriftItem } from "../lib/signals.js";
import { createDriftId } from "../lib/signals.js";
import { readDrift, writeDrift } from "../lib/files.js";

export function computeDrift(diff: SpecDiff): {
  newItems: DriftItem[];
  state: DriftState;
} {
  const existing = readDrift();
  const newItems: DriftItem[] = [];

  const existingFingerprints = new Set(existing.items.map((item) => fingerprint(item)));

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
  return { newItems, state };
}

export function resolveDriftItem(
  id: string,
  action: "accepted" | "rejected" | "skipped",
  note?: string
): DriftState {
  const state = readDrift();
  const item = state.items.find((i) => i.id === id);
  if (item) {
    item.status = action === "skipped" ? "unresolved" : action;
    if (note) item.note = note;
  }
  writeDrift(state);
  return state;
}

function fingerprint(item: DriftItem): string {
  return `${item.type}:${item.system ?? ""}:${item.risk ?? ""}`;
}
