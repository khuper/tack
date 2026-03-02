import type { Signal, DetectorResult } from "../lib/signals.js";
import { createSignal } from "../lib/signals.js";

export function detectDuplicates(allSignals: Signal[]): DetectorResult {
  const signals: Signal[] = [];

  const systemSignals = allSignals.filter((s) => s.category === "system");
  const grouped = new Map<string, Signal[]>();
  for (const sig of systemSignals) {
    const existing = grouped.get(sig.id) ?? [];
    existing.push(sig);
    grouped.set(sig.id, existing);
  }

  for (const [id, sigs] of grouped) {
    if (sigs.length <= 1) continue;

    const details = sigs
      .map((s) => s.detail)
      .filter((d): d is string => Boolean(d))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (details.length > 1) {
      signals.push(
        createSignal(
          "risk",
          `duplicate_${id}`,
          sigs.map((s) => s.source).join(" + "),
          0.9,
          `Multiple ${id} systems: ${details.join(" + ")}`
        )
      );
    }
  }

  return { name: "duplicates", signals };
}
