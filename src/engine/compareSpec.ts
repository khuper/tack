import type { Signal, Spec, SpecDiff, Violation } from "../lib/signals.js";

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
    const matchingSignal = systems.find((s) => {
      if (key === "framework") return s.id === "framework";
      if (key === "db") return s.id === "db";
      if (key === "auth") return s.id === "auth";
      if (key === "deploy") return s.id === "deploy";
      return false;
    });

    if (matchingSignal?.detail) {
      const detectedDetail = matchingSignal.detail.toLowerCase();
      const expected = expectedValue.toLowerCase();

      if (!detectedDetail.includes(expected)) {
        violations.push({
          type: "constraint_mismatch",
          signal: matchingSignal,
          spec_rule: `constraints.${key} expects "${expectedValue}" but found "${matchingSignal.detail}"`,
          severity: "error",
        });
      }
    }
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
