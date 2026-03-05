import { blue, bold, gray, green, red } from "./colors.js";
import { computeArchDiff } from "../engine/diff.js";

export function runDiffPlain(baseBranch: string | undefined): boolean {
  if (!baseBranch) {
    // eslint-disable-next-line no-console
    console.error(
      "Missing base branch. Usage: tack diff <base-branch>",
    );
    return false;
  }

  let diff;
  try {
    diff = computeArchDiff(baseBranch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`✗ ${message}`);
    return false;
  }

  const header = `${bold("Architecture diff")} ${gray(
    `(base: ${baseBranch}, head: ${diff.headRef})`,
  )}`;
  // eslint-disable-next-line no-console
  console.log(header);
  // eslint-disable-next-line no-console
  console.log("");

  if (diff.warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.log(red("Warnings:"));
    for (const w of diff.warnings) {
      // eslint-disable-next-line no-console
      console.log(`  - ${w}`);
    }
    // eslint-disable-next-line no-console
    console.log("");
  }

  // Systems
  // eslint-disable-next-line no-console
  console.log(bold("Systems:"));
  if (!diff.systems.available) {
    // eslint-disable-next-line no-console
    console.log(
      gray("  (systems diff unavailable; see warnings above)"),
    );
  } else if (
    diff.systems.added.length === 0 &&
    diff.systems.removed.length === 0 &&
    diff.systems.changed.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(green("  No system-level changes detected."));
  } else {
    if (diff.systems.added.length > 0) {
      // eslint-disable-next-line no-console
      console.log(green("  Systems added:"));
      for (const s of diff.systems.added) {
        const detail = s.detail ? `: ${s.detail}` : "";
        // eslint-disable-next-line no-console
        console.log(`    + ${s.id}${detail}`);
      }
    }
    if (diff.systems.removed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(red("  Systems removed:"));
      for (const s of diff.systems.removed) {
        const detail = s.detail ? `: ${s.detail}` : "";
        // eslint-disable-next-line no-console
        console.log(`    - ${s.id}${detail}`);
      }
    }
    if (diff.systems.changed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(blue("  Systems changed:"));
      for (const change of diff.systems.changed) {
        const before = change.before.detail ?? "unknown";
        const after = change.after.detail ?? "unknown";
        // eslint-disable-next-line no-console
        console.log(`    ~ ${change.id}: ${before} → ${after}`);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log("");

  // Drift
  // eslint-disable-next-line no-console
  console.log(bold("Drift:"));
  if (!diff.drift.available) {
    // eslint-disable-next-line no-console
    console.log(
      gray("  (drift status diff unavailable; see warnings above)"),
    );
  } else if (
    diff.drift.newlyUnresolved.length === 0 &&
    diff.drift.resolved.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(green("  No drift status changes detected."));
  } else {
    if (diff.drift.newlyUnresolved.length > 0) {
      // eslint-disable-next-line no-console
      console.log(red("  Newly unresolved drift items:"));
      for (const item of diff.drift.newlyUnresolved) {
        const key = item.system ?? item.risk ?? item.type;
        // eslint-disable-next-line no-console
        console.log(`    + ${key}: ${item.signal}`);
      }
    }
    if (diff.drift.resolved.length > 0) {
      // eslint-disable-next-line no-console
      console.log(green("  Resolved drift items:"));
      for (const change of diff.drift.resolved) {
        const before = change.before;
        const key =
          before?.system ?? before?.risk ?? before?.type ?? change.id;
        const finalStatus = change.after?.status ?? "resolved";
        // eslint-disable-next-line no-console
        console.log(
          `    - ${key}: unresolved → ${finalStatus}${
            before?.signal ? ` (${before.signal})` : ""
          }`,
        );
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log("");

  // Decisions
  // eslint-disable-next-line no-console
  console.log(bold("Decisions added since base:"));
  if (diff.decisions.newDecisions.length === 0) {
    // eslint-disable-next-line no-console
    console.log(gray("  (no new decisions)"));
  } else {
    for (const d of diff.decisions.newDecisions) {
      // eslint-disable-next-line no-console
      console.log(`  - [${d.date}] ${d.decision} — ${d.reasoning}`);
    }
  }

  return true;
}

