import React, { useState } from "react";
import { Text, Box, useApp } from "ink";
import { DetectorSweep } from "./DetectorSweep.js";
import { SpecSummary } from "./SpecSummary.js";
import { readSpec, readDrift, writeAudit } from "../lib/files.js";
import { createAudit, type Signal } from "../lib/signals.js";
import { compareSpec } from "../engine/compareSpec.js";
import { computeDrift } from "../engine/computeDrift.js";
import { log } from "../lib/logger.js";

type Phase = "check" | "sweep" | "summary" | "error";

export function Status() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("check");
  const [error, setError] = useState("");
  const [summaryData, setSummaryData] = useState<{
    spec: NonNullable<ReturnType<typeof readSpec>>;
    diff: ReturnType<typeof compareSpec>;
    drift: ReturnType<typeof readDrift>;
  } | null>(null);

  React.useEffect(() => {
    if (phase !== "check") return;
    const spec = readSpec();
    if (!spec) {
      setError("No spec.yaml found. Run 'tack init' first.");
      setPhase("error");
      setTimeout(() => exit(), 500);
      return;
    }
    setPhase("sweep");
  }, [phase, exit]);

  function handleSweepComplete(signals: Signal[]) {
    const spec = readSpec();
    if (!spec) {
      setError("No spec.yaml found. Run 'tack init' first.");
      setPhase("error");
      setTimeout(() => exit(), 500);
      return;
    }

    const audit = createAudit(signals);
    writeAudit(audit);

    const diff = compareSpec(signals, spec);
    const { state } = computeDrift(diff);

    log({
      event: "scan",
      systems: diff.aligned.length,
      scope_signals: signals.filter((s) => s.category === "scope").length,
      risks: diff.risks.length,
    });

    setSummaryData({ spec, diff, drift: state });
    setPhase("summary");

    setTimeout(() => exit(), 100);
  }

  return (
    <Box flexDirection="column">
      {phase === "sweep" && <DetectorSweep onComplete={handleSweepComplete} />}

      {phase === "summary" && summaryData && <SpecSummary spec={summaryData.spec} diff={summaryData.diff} drift={summaryData.drift} />}

      {phase === "error" && <Text color="red">✗ {error}</Text>}
    </Box>
  );
}
