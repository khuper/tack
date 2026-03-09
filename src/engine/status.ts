import { runAllDetectors } from "../detectors/index.js";
import { compareSpec } from "./compareSpec.js";
import { computeDrift } from "./computeDrift.js";
import { readSpec, writeAudit } from "../lib/files.js";
import { createAudit } from "../lib/signals.js";
import type { ProjectStatus, Signal, Spec, SpecDiff, DriftState } from "../lib/signals.js";
import { log } from "../lib/logger.js";
import { getMemoryWarnings } from "./memory.js";
import { getChangedFiles } from "../lib/git.js";

export type StatusResult = {
  spec: Spec;
  diff: SpecDiff;
  drift: DriftState;
  status: ProjectStatus;
};

export function buildProjectStatus(spec: Spec, diff: SpecDiff, drift: DriftState): ProjectStatus {
  const unresolved = drift.items.filter((i) => i.status === "unresolved");
  const driftItems = unresolved.map((item) => ({
    system: item.system ?? item.risk ?? item.type,
    message: item.signal,
  }));
  const changedFiles = getChangedFiles();

  return {
    name: spec.project,
    health: unresolved.length > 0 ? "drift" : "aligned",
    driftCount: unresolved.length,
    driftItems,
    lastScan: new Date().toISOString(),
    memoryWarnings: getMemoryWarnings(changedFiles),
  };
}

export function computeStatusFromSignals(signals: Signal[]): StatusResult | null {
  const startedAt = Date.now();
  const spec = readSpec();
  if (!spec) return null;

  const audit = createAudit(signals);
  writeAudit(audit);

  const diff = compareSpec(signals, spec);
  const { state } = computeDrift(diff);

  log({
    event: "scan",
    systems_detected: signals.filter((s) => s.category === "system").length,
    drift_items: state.items.filter((item) => item.status === "unresolved").length,
    duration_ms: Date.now() - startedAt,
  });

  return {
    spec,
    diff,
    drift: state,
    status: buildProjectStatus(spec, diff, state),
  };
}

export function runStatusScan(): StatusResult | null {
  const { signals } = runAllDetectors();
  return computeStatusFromSignals(signals);
}
