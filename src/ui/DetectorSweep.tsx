import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import Spinner from "ink-spinner";
import { PRIMARY_DETECTORS } from "../detectors/index.js";
import type { Signal, DetectorResult } from "../lib/signals.js";
import { detectDuplicates } from "../detectors/duplicates.js";

type SweepStatus = "pending" | "running" | "done" | "warning";

type DetectorState = {
  name: string;
  displayName: string;
  status: SweepStatus;
  result?: DetectorResult;
  summary?: string;
};

type Props = {
  onComplete: (signals: Signal[]) => void;
};

export function DetectorSweep({ onComplete }: Props) {
  const [detectors, setDetectors] = useState<DetectorState[]>(
    PRIMARY_DETECTORS.map((d) => ({
      name: d.name,
      displayName: d.displayName,
      status: "pending" as SweepStatus,
    }))
  );

  useEffect(() => {
    async function runSweep() {
      const allSignals: Signal[] = [];

      for (let i = 0; i < PRIMARY_DETECTORS.length; i += 1) {
        const detector = PRIMARY_DETECTORS[i]!;

        setDetectors((prev) => prev.map((d, idx) => (idx === i ? { ...d, status: "running" } : d)));
        await new Promise((r) => setTimeout(r, 80));

        const result = detector.run();
        allSignals.push(...result.signals);

        let summary = "none";
        if (result.signals.length > 0) {
          summary = result.signals.map((s) => s.detail ?? s.id).join(" + ");
        }

        setDetectors((prev) =>
          prev.map((d, idx) =>
            idx === i
              ? {
                  ...d,
                  status: "done",
                  result,
                  summary,
                }
              : d
          )
        );
      }

      const dupeResult = detectDuplicates(allSignals);
      allSignals.push(...dupeResult.signals);

      if (dupeResult.signals.length > 0) {
        setDetectors((prev) => [
          ...prev,
          {
            name: "duplicates",
            displayName: "Checking for duplicate systems",
            status: "warning",
            result: dupeResult,
            summary: dupeResult.signals.map((s) => s.detail ?? s.id).join(", "),
          },
        ]);
      }

      onComplete(allSignals);
    }

    void runSweep();
  }, [onComplete]);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Scanning project...</Text>
      <Box flexDirection="column" marginTop={1}>
        {detectors.map((d) => (
          <Box key={d.name}>
            <Box width={2}>
              {d.status === "running" && <Spinner type="dots" />}
              {d.status === "done" && <Text color="green">✓</Text>}
              {d.status === "warning" && <Text color="yellow">⚠</Text>}
              {d.status === "pending" && <Text dimColor>○</Text>}
            </Box>
            <Text>
              {" "}
              {d.displayName}
              {d.summary && d.status !== "pending" && d.status !== "running" && <Text dimColor>: {d.summary}</Text>}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
