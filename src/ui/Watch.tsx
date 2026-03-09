import React, { useEffect, useRef, useState } from "react";
import { Text, Box, Static, useApp, useInput } from "ink";
import * as path from "node:path";
import chokidar from "chokidar";
import { Logo } from "./Logo.js";
import { DriftAlert } from "./DriftAlert.js";
import { MascotLane } from "./MascotLane.js";
import { readSpec, readDrift, writeAudit, logsPath } from "../lib/files.js";
import type { DriftItem } from "../lib/signals.js";
import { createAudit } from "../lib/signals.js";
import { runAllDetectors } from "../detectors/index.js";
import { compareSpec } from "../engine/compareSpec.js";
import { computeDrift } from "../engine/computeDrift.js";
import { getMemoryWarnings } from "../engine/memory.js";
import { getChangedFiles } from "../lib/git.js";
import { notify } from "../lib/notify.js";
import { log, createMcpActivityMonitor, type McpActivityNotice } from "../lib/logger.js";

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

type HistoryLevel = "good" | "bad" | "update" | "mcp";

type HistoryEvent = {
  id: number;
  level: HistoryLevel;
  text: string;
};

type WatchProps = {
  animationsEnabled: boolean;
};

function renderHistoryBadge(level: HistoryLevel) {
  if (level === "mcp") {
    return (
      <Text color="cyan" bold>
        {"⚡ tack"}
      </Text>
    );
  }

  if (level === "update" || level === "good" || level === "bad") {
    return (
      <Text backgroundColor="yellow" color="black" bold>
        {" CHECK "}
      </Text>
    );
  }

  return null;
}

export function Watch({ animationsEnabled }: WatchProps) {
  const { exit } = useApp();
  const [systemCount, setSystemCount] = useState(0);
  const [driftCount, setDriftCount] = useState(0);
  const [lastScan, setLastScan] = useState<string>("never");
  const [pendingAlerts, setPendingAlerts] = useState<DriftItem[]>([]);
  const [projectName, setProjectName] = useState("unknown");
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [memoryWarnings, setMemoryWarnings] = useState<string[]>([]);
  const [mascotMode, setMascotMode] = useState<"idle" | "scan" | "mcp">("idle");
  const [mascotAnimated, setMascotAnimated] = useState(animationsEnabled);
  const [cargoCount, setCargoCount] = useState(0);
  const watcherRef = useRef<chokidar.FSWatcher | null>(null);
  const logsWatcherRef = useRef<chokidar.FSWatcher | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mascotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cargoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const historySeq = useRef(0);
  const readNewMcpActivityRef = useRef<(() => McpActivityNotice[]) | null>(null);

  function pushHistory(level: HistoryLevel, text: string): void {
    historySeq.current += 1;
    setHistory((prev) => {
      const next = [...prev, { id: historySeq.current, level, text }];
      return next.slice(-40);
    });
  }

  function cueMascot(mode: "scan" | "mcp", durationMs: number): void {
    setMascotMode(mode);
    if (mascotTimerRef.current) {
      clearTimeout(mascotTimerRef.current);
    }
    mascotTimerRef.current = setTimeout(() => {
      setMascotMode("idle");
      mascotTimerRef.current = null;
    }, durationMs);
  }

  function addCargoPackage(): void {
    setCargoCount((current) => Math.min(current + 1, 3));
    const timer = setTimeout(() => {
      setCargoCount((current) => Math.max(current - 1, 0));
      cargoTimersRef.current = cargoTimersRef.current.filter((candidate) => candidate !== timer);
    }, 4000);
    cargoTimersRef.current.push(timer);
  }

  function runScan(reason = "scan") {
    const startedAt = Date.now();
    const spec = readSpec();
    if (!spec) return;

    cueMascot("scan", 1400);
    setProjectName(spec.project);

    const { signals } = runAllDetectors();
    const audit = createAudit(signals);
    writeAudit(audit);

    const diff = compareSpec(signals, spec);
    const { newItems, state } = computeDrift(diff);
    const unresolvedCount = state.items.filter((item) => item.status === "unresolved").length;

    setSystemCount(diff.aligned.filter((signal) => signal.category === "system").length);
    setDriftCount(unresolvedCount);
    setLastScan(new Date().toLocaleTimeString());
    setMemoryWarnings(getMemoryWarnings(getChangedFiles()));

    const scanTs = new Date().toLocaleTimeString();
    if (unresolvedCount === 0) {
      pushHistory("good", `[${scanTs}] ${reason}: scan clean (0 drift)`);
    } else {
      pushHistory("bad", `[${scanTs}] ${reason}: ${unresolvedCount} unresolved drift item(s)`);
    }

    log({
      event: "scan",
      systems_detected: signals.filter((signal) => signal.category === "system").length,
      drift_items: unresolvedCount,
      duration_ms: Date.now() - startedAt,
    });

    const alertable = newItems.filter(
      (item) =>
        item.type === "forbidden_system_detected" ||
        item.type === "constraint_mismatch" ||
        item.type === "risk" ||
        item.type === "undeclared_system"
    );

    if (alertable.length > 0) {
      for (const item of alertable) {
        notify("! Tack: Drift Detected", `${item.system ?? item.risk}: ${item.signal}`);
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
    readNewMcpActivityRef.current = createMcpActivityMonitor();

    const watcher = chokidar.watch(".", {
      ignored: IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });
    const logsWatcher = chokidar.watch(logsPath(), {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on("all", (event, filepath) => {
      if (filepath.includes(`${path.sep}.tack${path.sep}`)) return;
      if (filepath.startsWith(".tack/") || filepath.startsWith(".tack\\")) return;
      cueMascot("scan", 900);
      pushHistory("update", "Filesystem change detected. Running scan...");
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        runScan(`change (${event})`);
      }, 300);
    });
    logsWatcher.on("change", () => {
      const notices = readNewMcpActivityRef.current?.() ?? [];
      for (const notice of notices) {
        cueMascot("mcp", 1600);
        addCargoPackage();
        pushHistory("mcp", notice.message);
      }
    });

    watcherRef.current = watcher;
    logsWatcherRef.current = logsWatcher;

    return () => {
      void watcher.close();
      void logsWatcher.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current);
      for (const timer of cargoTimersRef.current) {
        clearTimeout(timer);
      }
      cargoTimersRef.current = [];
    };
  }, [exit]);

  function handleAlertResolved() {
    setPendingAlerts((prev) => prev.slice(1));
    const drift = readDrift();
    setDriftCount(drift.items.filter((item) => item.status === "unresolved").length);
  }

  useInput((input) => {
    if (input === "q") {
      void watcherRef.current?.close();
      void logsWatcherRef.current?.close();
      exit();
      return;
    }

    if (input === "a") {
      setMascotAnimated((current) => !current);
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

      <MascotLane animate={mascotAnimated} mode={mascotMode} cargoCount={cargoCount} hasDrift={driftCount > 0} />

      {pendingAlerts.length > 0 && pendingAlerts[0] && <DriftAlert item={pendingAlerts[0]} onResolved={handleAlertResolved} />}

      {pendingAlerts.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Watching for changes and MCP activity... (q to quit, a to {mascotAnimated ? "freeze" : "animate"} deckhand)
          </Text>
        </Box>
      )}

      {memoryWarnings.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Memory hygiene</Text>
          {memoryWarnings.map((warning) => (
            <Text key={warning} color="yellow">
              - {warning}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Static items={history}>
          {(item: HistoryEvent) => (
            <Box key={item.id}>
              {renderHistoryBadge(item.level)}
              <Text> </Text>
              <Text color={item.level === "good" ? "green" : item.level === "bad" ? "red" : item.level === "mcp" ? "cyan" : "yellow"}>
                {item.text}
              </Text>
            </Box>
          )}
        </Static>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>--- Run in another terminal -----------</Text>
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
