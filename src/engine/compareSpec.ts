import type { Signal, Spec, SpecDiff, Violation } from "../lib/signals.js";

/** Constraint keys that map onto a detected system signal of the same id. */
const CONSTRAINT_SIGNAL_IDS = new Set(["framework", "db", "auth", "deploy"]);

export function compareSpec(signals: Signal[], spec: Spec): SpecDiff {
  const systems = signals.filter((s) => s.category === "system");
  const scopes = signals.filter((s) => s.category === "scope");
  const risks = signals.filter((s) => s.category === "risk");

  const aligned: Signal[] = [];
  const violations: Violation[] = [];
  const undeclared: Signal[] = [];

  for (const sig of systems) {
    if (spec.allowed_systems.includes(sig.id)) {
      aligned.push(sig);
    } else if (spec.forbidden_systems.includes(sig.id)) {
      violations.push({
        type: "forbidden_system",
        signal: sig,
        spec_rule: `forbidden_systems contains "${sig.id}"`,
        severity: "error",
      });
    } else {
      undeclared.push(sig);
    }
  }

  for (const sig of scopes) {
    if (spec.forbidden_systems.includes(sig.id)) {
      violations.push({
        type: "forbidden_system",
        signal: sig,
        spec_rule: `forbidden_systems contains "${sig.id}"`,
        severity: "error",
      });
    } else if (!spec.allowed_systems.includes(sig.id)) {
      undeclared.push(sig);
    } else {
      aligned.push(sig);
    }
  }

  for (const [key, expectedValue] of Object.entries(spec.constraints)) {
    if (!CONSTRAINT_SIGNAL_IDS.has(key)) continue;

    // Detectors emit one signal per matched sub-system under the same id (a project on
    // Prisma over Postgres yields both `db=prisma` and `db=postgres`), so the constraint
    // holds when ANY of them matches. Checking only the first would raise a false
    // mismatch that, once accepted, suppresses every real one for that key.
    const matchingSignals = systems.filter((s) => s.id === key && !!s.detail);
    if (matchingSignals.length === 0) continue;

    const expected = expectedValue.toLowerCase();
    const satisfied = matchingSignals.some((s) => s.detail!.toLowerCase().includes(expected));
    if (satisfied) continue;

    const found = matchingSignals.map((s) => s.detail!).join(", ");
    violations.push({
      type: "constraint_mismatch",
      signal: matchingSignals[0]!,
      spec_rule: `constraints.${key} expects "${expectedValue}" but found "${found}"`,
      severity: "error",
    });
  }

  const detectedIds = new Set([...systems.map((s) => s.id), ...scopes.map((s) => s.id)]);
  const missing = spec.allowed_systems.filter((id) => !detectedIds.has(id));

  return {
    aligned,
    violations,
    undeclared,
    missing,
    risks,
  };
}
