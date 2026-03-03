import React, { useState } from "react";
import { Text, Box, useApp } from "ink";
import { DetectorSweep } from "./DetectorSweep.js";
import { SpecSummary } from "./SpecSummary.js";
import type { Signal } from "../lib/signals.js";
import { readDrift, readSpec } from "../lib/files.js";
import { compareSpec } from "../engine/compareSpec.js";
import { computeStatusFromSignals } from "../engine/status.js";

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
    const computed = computeStatusFromSignals(signals);
    if (!computed) {
      setError("No spec.yaml found. Run 'tack init' first.");
      setPhase("error");
      setTimeout(() => exit(), 500);
      return;
    }

    setSummaryData({ spec: computed.spec, diff: computed.diff, drift: computed.drift });
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
