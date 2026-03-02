import React, { useState, useEffect, useRef } from "react";
import { Text, Box, useApp, useInput } from "ink";
import { Logo } from "./Logo.js";
import { DriftAlert } from "./DriftAlert.js";
import { readSpec, readDrift, writeAudit } from "../lib/files.js";
import type { DriftItem } from "../lib/signals.js";
import { createAudit } from "../lib/signals.js";
import { runAllDetectors } from "../detectors/index.js";
import { compareSpec } from "../engine/compareSpec.js";
import { computeDrift } from "../engine/computeDrift.js";
import { notify } from "../lib/notify.js";
import { log } from "../lib/logger.js";
import chokidar from "chokidar";

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/tack/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.cache/**",
  "**/.svelte-kit/**",
  "**/coverage/**",
  "**/venv/**",
  "**/.venv/**",
  "**/env/**",
  "**/site-packages/**",
];

export function Watch() {
  const { exit } = useApp();
  const [systemCount, setSystemCount] = useState(0);
  const [driftCount, setDriftCount] = useState(0);
  const [lastScan, setLastScan] = useState<string>("never");
  const [pendingAlerts, setPendingAlerts] = useState<DriftItem[]>([]);
  const [projectName, setProjectName] = useState("unknown");
  const watcherRef = useRef<chokidar.FSWatcher | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function runScan() {
    const spec = readSpec();
    if (!spec) return;

    setProjectName(spec.project);

    const { signals } = runAllDetectors();
    const audit = createAudit(signals);
    writeAudit(audit);

    const diff = compareSpec(signals, spec);
    const { newItems, state } = computeDrift(diff);

    setSystemCount(diff.aligned.filter((s) => s.category === "system").length);
    setDriftCount(state.items.filter((i) => i.status === "unresolved").length);
    setLastScan(new Date().toLocaleTimeString());

    log({
      event: "scan",
      systems: diff.aligned.length,
      scope_signals: signals.filter((s) => s.category === "scope").length,
      risks: diff.risks.length,
    });

    const alertable = newItems.filter(
      (i) => i.type === "forbidden_system_detected" || i.type === "constraint_mismatch" || i.type === "risk"
    );

    if (alertable.length > 0) {
      for (const item of alertable) {
        notify("⚠ Tack: Drift Detected", `${item.system ?? item.risk}: ${item.signal}`);
        log({
          event: "drift",
          id: item.id,
          type: item.type,
          system: item.system,
          risk: item.risk,
        });
      }

      setPendingAlerts((prev) => [...prev, ...alertable]);
    }
  }

  useEffect(() => {
    const spec = readSpec();
    if (!spec) {
      // eslint-disable-next-line no-console
      console.error("No spec.yaml found. Run 'tack init' first.");
      exit();
      return;
    }

    runScan();

    const watcher = chokidar.watch(".", {
      ignored: IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    watcher.on("all", () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        runScan();
      }, 300);
    });

    watcherRef.current = watcher;

    return () => {
      void watcher.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [exit]);

  function handleAlertResolved() {
    setPendingAlerts((prev) => prev.slice(1));
    const drift = readDrift();
    setDriftCount(drift.items.filter((i) => i.status === "unresolved").length);
  }

  useInput((input) => {
    if (input === "q") {
      void watcherRef.current?.close();
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Logo />

      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text>
          <Text bold>{projectName}</Text>
          {"  "}
          <Text color="green">{systemCount} systems</Text>
          {"  "}
          {driftCount > 0 ? <Text color="yellow">{driftCount} drift</Text> : <Text color="green">0 drift</Text>}
        </Text>
        <Text dimColor>Last scan: {lastScan} • q to quit</Text>
      </Box>

      {pendingAlerts.length > 0 && pendingAlerts[0] && <DriftAlert item={pendingAlerts[0]} onResolved={handleAlertResolved} />}

      {pendingAlerts.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>Watching for changes...</Text>
        </Box>
      )}
    </Box>
  );
}
