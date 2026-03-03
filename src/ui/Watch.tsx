import React, { useState, useEffect, useRef } from "react";
import { Text, Box, Static, useApp, useInput } from "ink";
import * as path from "node:path";
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
  "**/.tack/**",
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

type HistoryLevel = "good" | "bad" | "update";

type HistoryEvent = {
  id: number;
  level: HistoryLevel;
  text: string;
};

export function Watch() {
  const { exit } = useApp();
  const [systemCount, setSystemCount] = useState(0);
  const [driftCount, setDriftCount] = useState(0);
  const [lastScan, setLastScan] = useState<string>("never");
  const [pendingAlerts, setPendingAlerts] = useState<DriftItem[]>([]);
  const [projectName, setProjectName] = useState("unknown");
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const watcherRef = useRef<chokidar.FSWatcher | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historySeq = useRef(0);

  function pushHistory(level: HistoryLevel, text: string): void {
    historySeq.current += 1;
    setHistory((prev) => {
      const next = [...prev, { id: historySeq.current, level, text }];
      return next.slice(-40);
    });
  }

  function runScan(reason = "scan") {
    const startedAt = Date.now();
    const spec = readSpec();
    if (!spec) return;

    setProjectName(spec.project);

    const { signals } = runAllDetectors();
    const audit = createAudit(signals);
    writeAudit(audit);

    const diff = compareSpec(signals, spec);
    const { newItems, state } = computeDrift(diff);
    const unresolvedCount = state.items.filter((i) => i.status === "unresolved").length;

    setSystemCount(diff.aligned.filter((s) => s.category === "system").length);
    setDriftCount(unresolvedCount);
    setLastScan(new Date().toLocaleTimeString());

    const scanTs = new Date().toLocaleTimeString();
    if (unresolvedCount === 0) {
      pushHistory("good", `[${scanTs}] ${reason}: scan clean (0 drift)`);
    } else {
      pushHistory("bad", `[${scanTs}] ${reason}: ${unresolvedCount} unresolved drift item(s)`);
    }

    log({
      event: "scan",
      systems_detected: signals.filter((s) => s.category === "system").length,
      drift_items: unresolvedCount,
      duration_ms: Date.now() - startedAt,
    });

    const alertable = newItems.filter(
      (i) =>
        i.type === "forbidden_system_detected" ||
        i.type === "constraint_mismatch" ||
        i.type === "risk" ||
        i.type === "undeclared_system"
    );

    if (alertable.length > 0) {
      for (const item of alertable) {
        notify("⚠ Tack: Drift Detected", `${item.system ?? item.risk}: ${item.signal}`);
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

    watcher.on("all", (event, filepath) => {
      if (filepath.includes(`${path.sep}.tack${path.sep}`)) return;
      if (filepath.startsWith(".tack/") || filepath.startsWith(".tack\\")) return;
      pushHistory("update", "Filesystem change detected. Running scan...");
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        runScan(`change (${event})`);
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
        <Text dimColor>Last scan: {lastScan}</Text>
      </Box>

      {pendingAlerts.length > 0 && pendingAlerts[0] && <DriftAlert item={pendingAlerts[0]} onResolved={handleAlertResolved} />}

      {pendingAlerts.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>Watching for changes... (q to quit)</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Static items={history}>
          {(item: HistoryEvent) => (
            <Text color={item.level === "good" ? "green" : item.level === "bad" ? "red" : "blue"}>
              {item.text}
            </Text>
          )}
        </Static>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>─── Run in another terminal ───────────</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color="green">tack status</Text>
          <Text dimColor>     Project health snapshot</Text>
        </Text>
        <Text>
          <Text color="green">tack handoff</Text>
          <Text dimColor>    Generate handoff for agents</Text>
        </Text>
        <Text>
          <Text color="green">tack check-in</Text>
          <Text dimColor>   Morning/evening pulse</Text>
        </Text>
        <Text>
          <Text color="green">tack log</Text>
          <Text dimColor>        View or append decisions</Text>
        </Text>
        <Text>
          <Text color="green">tack help</Text>
          <Text dimColor>       All commands and options</Text>
        </Text>
      </Box>
    </Box>
  );
}
