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
import {
  log,
  collectMcpInactivityWarnings,
  createMcpActivityMonitor,
  getMcpInstallVerification,
  getMcpSessionDisplayLabel,
  markMcpSessionsRepoChanged,
  refreshMcpSessionStates,
  upsertMcpSessionState,
  type McpActivityCategory,
  type McpActivityNotice,
  type McpSessionHealth,
  type McpSessionState,
} from "../lib/logger.js";

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

type HistoryLevel = "good" | "bad" | "update" | "ready" | "read" | "check" | "write" | "warn";

type HistoryEvent = {
  id: number;
  level: HistoryLevel;
  text: string;
};

type WatchProps = {
  animationsEnabled: boolean;
};

const USEFUL_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "tack status", description: "Full health snapshot and drift details" },
  { command: "tack handoff", description: "Package the current state for the next session" },
  { command: "tack note", description: "Add or inspect agent notes" },
  { command: "tack log", description: "View or append decisions" },
  { command: "checkpoint_work", description: "Default MCP write-back before ending work" },
  { command: "tack help", description: "Show all commands and options" },
];

const USEFUL_COMMANDS_LABEL_WIDTH = USEFUL_COMMANDS.reduce(
  (max, item) => Math.max(max, item.command.length),
  0
);

function renderHistoryBadge(level: HistoryLevel) {
  if (level === "ready") {
    return (
      <Text backgroundColor="blue" color="white" bold>
        {" READY "}
      </Text>
    );
  }

  if (level === "read") {
    return (
      <Text color="cyan" bold>
        {" READ "}
      </Text>
    );
  }

  if (level === "check") {
    return (
      <Text backgroundColor="magenta" color="white" bold>
        {" CHECK "}
      </Text>
    );
  }

  if (level === "write") {
    return (
      <Text backgroundColor="green" color="black" bold>
        {" WRITE "}
      </Text>
    );
  }

  if (level === "warn") {
    return (
      <Text backgroundColor="yellow" color="black" bold>
        {" WARN "}
      </Text>
    );
  }

  return (
    <Text backgroundColor="yellow" color="black" bold>
      {" SCAN "}
    </Text>
  );
}

function historyLevelColor(level: HistoryLevel): "green" | "red" | "yellow" | "cyan" | "magenta" | "blue" {
  if (level === "good" || level === "write") return "green";
  if (level === "bad") return "red";
  if (level === "read") return "cyan";
  if (level === "check") return "magenta";
  if (level === "ready") return "blue";
  return "yellow";
}

function noticeToHistoryLevel(category: McpActivityCategory): HistoryLevel {
  return category === "ready" ? "ready" : category === "read" ? "read" : category === "check" ? "check" : "write";
}

function sessionSummary(state: McpSessionState): { text: string; color: "green" | "yellow" | "cyan" | "magenta" | "blue" | "red" } {
  if (state.awaitingWriteBack && state.repoChangedAfterRead && state.health === "stale") {
    return { text: "stale after repo changes", color: "red" };
  }
  if (state.awaitingWriteBack && state.repoChangedAfterRead && state.health === "idle") {
    return { text: "idle after repo changes", color: "yellow" };
  }
  if (state.awaitingWriteBack && state.repoChangedAfterRead) {
    return { text: "waiting for write-back", color: "yellow" };
  }
  if (state.health === "stale") {
    return { text: "stale", color: "red" };
  }
  if (state.health === "idle") {
    return { text: "idle", color: "yellow" };
  }
  if (state.lastAction === "write") {
    return { text: "memory saved", color: "green" };
  }
  if (state.lastAction === "check") {
    return { text: "checked a guardrail", color: "magenta" };
  }
  if (state.lastAction === "read") {
    return { text: "read context", color: "cyan" };
  }
  return { text: "connected", color: "blue" };
}

function healthLabel(health: McpSessionHealth): string {
  return health === "active" ? "active" : health === "idle" ? "idle" : "stale";
}

function renderVerificationStatus(status: "pending" | "done", text: string, detail?: string): React.JSX.Element {
  return (
    <Box>
      <Text color={status === "done" ? "green" : "yellow"}>{status === "done" ? "[done]" : "[wait]"}</Text>
      <Text> </Text>
      <Text color={status === "done" ? "green" : "yellow"}>{text}</Text>
      {detail ? <Text dimColor>{`  ${detail}`}</Text> : null}
    </Box>
  );
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
  const [sessionStates, setSessionStates] = useState<McpSessionState[]>([]);
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
  const missingWriteBackWarningActiveRef = useRef(false);
  const sessionStatesRef = useRef<McpSessionState[]>([]);
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const installVerification = getMcpInstallVerification(sessionStates);

  function pushHistory(level: HistoryLevel, text: string): void {
    historySeq.current += 1;
    setHistory((prev) => {
      const next = [...prev, { id: historySeq.current, level, text }];
      return next.slice(-60);
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

  function syncSessionStates(next: McpSessionState[]): void {
    sessionStatesRef.current = next;
    setSessionStates(next);
  }

  function applyActivityNotice(notice: McpActivityNotice): void {
    const next = upsertMcpSessionState(sessionStatesRef.current, notice);
    syncSessionStates(next);
    cueMascot("mcp", 1600);
    addCargoPackage();
    const display = getMcpSessionDisplayLabel(next.find((state) => state.sessionKey === notice.sessionKey) ?? next[0]!, next);
    pushHistory(noticeToHistoryLevel(notice.category), `[${display}] ${notice.message}`);
  }

  function runInactivityCycle(): void {
    const result = collectMcpInactivityWarnings(sessionStatesRef.current);
    syncSessionStates(result.states);
    for (const warning of result.warnings) {
      pushHistory("warn", warning);
    }
  }

  function runScan(reason = "scan") {
    const startedAt = Date.now();
    const spec = readSpec();
    if (!spec) return;
    const changedFiles = getChangedFiles();

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
    setMemoryWarnings(getMemoryWarnings(changedFiles));

    let nextSessions = refreshMcpSessionStates(sessionStatesRef.current);
    if (changedFiles.length > 0) {
      nextSessions = markMcpSessionsRepoChanged(nextSessions);
    }
    syncSessionStates(nextSessions);

    const riskySessions = nextSessions.filter((state) => state.awaitingWriteBack && state.repoChangedAfterRead);
    if (riskySessions.length > 0 && !missingWriteBackWarningActiveRef.current) {
      pushHistory("warn", `${riskySessions.map((state) => getMcpSessionDisplayLabel(state, nextSessions)).join(", ")} waiting on write-back after repo changes`);
      missingWriteBackWarningActiveRef.current = true;
    } else if (riskySessions.length === 0) {
      missingWriteBackWarningActiveRef.current = false;
    }

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
        applyActivityNotice(notice);
      }
    });

    inactivityTimerRef.current = setInterval(() => {
      runInactivityCycle();
    }, 30000);

    watcherRef.current = watcher;
    logsWatcherRef.current = logsWatcher;

    return () => {
      void watcher.close();
      void logsWatcher.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (mascotTimerRef.current) clearTimeout(mascotTimerRef.current);
      if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);
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
            Watching for repo changes and MCP activity... (q to quit, a to {mascotAnimated ? "freeze" : "animate"} deckhand)
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>How to use watch</Text>
        <Text dimColor>- File changes trigger fresh scans against your spec and drift rules.</Text>
        <Text dimColor>- READY/READ/CHECK/WRITE events show which session is grounding itself in Tack and preserving memory.</Text>
        <Text dimColor>- Idle or stale sessions after repo changes are the risky cases: those may leave the next session cold.</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Install Verification</Text>
        <Text color={installVerification.status === "write_seen" ? "green" : installVerification.status === "read_seen" ? "cyan" : "yellow"}>
          {installVerification.summary}
        </Text>
        {renderVerificationStatus(
          installVerification.status === "waiting_for_first_read" ? "pending" : "done",
          installVerification.status === "waiting_for_first_read" ? "waiting for first agent read" : "agent read tack://session",
          installVerification.readLabel ? `via ${installVerification.readLabel}` : "keep tack watch open while the agent starts"
        )}
        {renderVerificationStatus(
          installVerification.status === "write_seen" ? "done" : "pending",
          installVerification.status === "write_seen" ? "agent wrote memory back" : "waiting for first memory write-back",
          installVerification.writeLabel ? `via ${installVerification.writeLabel}` : "look for checkpoint_work, log_decision, or log_agent_note"
        )}
      </Box>

      {sessionStates.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Agent Sessions</Text>
          {sessionStates.slice(0, 6).map((state) => {
            const display = getMcpSessionDisplayLabel(state, sessionStates);
            const summary = sessionSummary(state);
            return (
              <Box key={state.sessionKey}>
                <Text color="cyan">{display}</Text>
                <Text dimColor>  </Text>
                <Text color={summary.color}>{summary.text}</Text>
                <Text dimColor>  ({healthLabel(state.health)})</Text>
                <Text dimColor>  last: {state.lastMessage}</Text>
              </Box>
            );
          })}
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
              <Text color={historyLevelColor(item.level)}>{item.text}</Text>
            </Box>
          )}
        </Static>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>--- Useful commands from another terminal ---</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {USEFUL_COMMANDS.map((item) => (
          <Text key={item.command}>
            <Text color="green">{item.command.padEnd(USEFUL_COMMANDS_LABEL_WIDTH)}</Text>
            <Text dimColor>  {item.description}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
