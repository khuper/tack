import React, { useEffect, useRef, useState } from "react";
import { Text, Box, Static, useApp, useInput } from "ink";
import { theme } from "./theme.js";
import { DriftAlert } from "./DriftAlert.js";
import { Logo } from "./Logo.js";
import { MascotLane } from "./MascotLane.js";
import { readSpec, readDrift, writeAudit } from "../lib/files.js";
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
  getMcpInstallVerification,
  getMcpSessionDisplayLabel,
  type McpActivityCategory,
  type McpActivityNotice,
  type McpSessionHealth,
  type McpSessionState,
} from "../lib/logger.js";
import { createWatchController, type WatchController } from "../lib/watchController.js";

type HistoryLevel = "good" | "bad" | "update" | "ready" | "read" | "check" | "write" | "warn";

type HistoryEvent = {
  id: number;
  level: HistoryLevel;
  text: string;
};

const USEFUL_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "tack status", description: "Full health snapshot and drift details" },
  { command: "checkpoint_work", description: "Default MCP write-back before ending work" },
  { command: "tack handoff", description: "Package the current state for the next session" },
  { command: "tack note", description: "Add or inspect agent notes" },
];

const USEFUL_COMMANDS_LABEL_WIDTH = USEFUL_COMMANDS.reduce(
  (max, item) => Math.max(max, item.command.length),
  0
);

function renderHistoryBadge(level: HistoryLevel) {
  if (level === "ready") {
    return (
      <Text backgroundColor={theme.primary} color={theme.onFill} bold>
        {" READY "}
      </Text>
    );
  }

  if (level === "read") {
    return (
      <Text color={theme.agent} bold>
        {" READ "}
      </Text>
    );
  }

  if (level === "check") {
    return (
      <Text backgroundColor={theme.check} color={theme.onFill} bold>
        {" CHECK "}
      </Text>
    );
  }

  if (level === "write") {
    return (
      <Text backgroundColor={theme.success} color={theme.onFill} bold>
        {" WRITE "}
      </Text>
    );
  }

  if (level === "warn") {
    return (
      <Text backgroundColor={theme.warning} color={theme.onFill} bold>
        {" WARN "}
      </Text>
    );
  }

  return (
    <Text backgroundColor={theme.primaryDeep} color={theme.onFill} bold>
      {" SCAN "}
    </Text>
  );
}

function historyLevelColor(level: HistoryLevel): string {
  if (level === "good" || level === "write") return theme.success;
  if (level === "bad") return theme.danger;
  if (level === "read") return theme.agent;
  if (level === "check") return theme.check;
  if (level === "ready" || level === "update") return theme.primary;
  return theme.warning;
}

function noticeToHistoryLevel(category: McpActivityCategory): HistoryLevel {
  return category === "ready" ? "ready" : category === "read" ? "read" : category === "check" ? "check" : category === "disconnect" ? "warn" : "write";
}

function formatAge(ms: number, now = Date.now()): string {
  const ageMs = Math.max(0, now - ms);
  if (ageMs < 60_000) {
    return `${Math.max(1, Math.round(ageMs / 1000))}s ago`;
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.round(ageMs / 60_000)}m ago`;
  }
  return `${Math.round(ageMs / (60 * 60_000))}h ago`;
}

function sessionSummary(state: McpSessionState): { text: string; color: string } {
  if (state.disconnectedAt != null || state.health === "disconnected") {
    return { text: "disconnected", color: theme.danger };
  }
  if (state.awaitingWriteBack && state.repoChangedAfterRead && state.health === "stale") {
    return { text: "stale after repo changes", color: theme.danger };
  }
  if (state.awaitingWriteBack && state.repoChangedAfterRead && state.health === "idle") {
    return { text: "idle after repo changes", color: theme.warning };
  }
  if (state.awaitingWriteBack && state.repoChangedAfterRead) {
    return { text: "waiting for write-back", color: theme.warning };
  }
  if (state.health === "stale") {
    return { text: "stale", color: theme.danger };
  }
  if (state.health === "idle") {
    return { text: "idle", color: theme.warning };
  }
  if (state.lastAction === "write") {
    return { text: "memory saved", color: theme.success };
  }
  if (state.lastAction === "check") {
    return { text: "checked a guardrail", color: theme.check };
  }
  if (state.lastAction === "read") {
    return { text: "read context", color: theme.agent };
  }
  return { text: "connected", color: theme.primary };
}

function healthLabel(health: McpSessionHealth): string {
  return health === "active" ? "active" : health === "idle" ? "idle" : health === "stale" ? "stale" : "disconnected";
}

function trustHeadline(
  installVerification: ReturnType<typeof getMcpInstallVerification>,
  sessionStates: McpSessionState[]
): { text: string; color: string } {
  const staleOrRisky = sessionStates.filter(
    (state) =>
      state.health === "stale" ||
      state.health === "disconnected" ||
      (state.awaitingWriteBack && state.repoChangedAfterRead)
  ).length;

  if (staleOrRisky > 0) {
    return {
      text: `${staleOrRisky} session${staleOrRisky === 1 ? "" : "s"} need attention`,
      color: theme.warning,
    };
  }

  if (installVerification.status === "write_seen") {
    return { text: "agent context loop verified", color: theme.success };
  }

  if (installVerification.status === "read_seen") {
    return { text: "agent has read context; waiting for write-back", color: theme.agent };
  }

  return { text: "waiting for first agent read", color: theme.warning };
}

function renderVerificationStatus(status: "pending" | "done", text: string, detail?: string): React.JSX.Element {
  return (
    <Box>
      <Text color={status === "done" ? theme.success : theme.warning}>{status === "done" ? "✓" : "○"}</Text>
      <Text> </Text>
      <Text color={status === "done" ? theme.success : theme.warning}>{text}</Text>
      {detail ? <Text dimColor>{`  ${detail}`}</Text> : null}
    </Box>
  );
}

type WatchProps = {
  /** Initial animation preference; `a` toggles it while watching. */
  animate?: boolean;
};

export function Watch({ animate = true }: WatchProps = {}) {
  const { exit } = useApp();
  const [animated, setAnimated] = useState(animate);
  const [cratesDocked, setCratesDocked] = useState(0);
  const [lastAgentEventAt, setLastAgentEventAt] = useState<number | null>(null);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [systemCount, setSystemCount] = useState(0);
  const [driftCount, setDriftCount] = useState(0);
  const [lastScan, setLastScan] = useState<string>("never");
  const [pendingAlerts, setPendingAlerts] = useState<DriftItem[]>([]);
  const [projectName, setProjectName] = useState("unknown");
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [memoryWarnings, setMemoryWarnings] = useState<string[]>([]);
  const [sessionStates, setSessionStates] = useState<McpSessionState[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const controllerRef = useRef<WatchController | null>(null);
  const historySeq = useRef(0);
  const sessionStatesRef = useRef<McpSessionState[]>([]);
  const lastScanHistoryRef = useRef<string | null>(null);
  const installVerification = getMcpInstallVerification(sessionStates);
  const headline = trustHeadline(installVerification, sessionStates);
  const visibleSessions = sessionStates.slice(0, 4);

  function pushHistory(level: HistoryLevel, text: string): void {
    historySeq.current += 1;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.level === level && last.text === text) {
        return prev;
      }
      const next = [...prev, { id: historySeq.current, level, text }];
      return next.slice(-12);
    });
  }

  function syncSessionStates(next: McpSessionState[]): void {
    sessionStatesRef.current = next;
    setSessionStates(next);
  }

  function applyActivityNotice(notice: McpActivityNotice, nextStates: McpSessionState[]): void {
    syncSessionStates(nextStates);
    const display = getMcpSessionDisplayLabel(nextStates.find((state) => state.sessionKey === notice.sessionKey) ?? nextStates[0]!, nextStates);
    pushHistory(noticeToHistoryLevel(notice.category), `[${display}] ${notice.message}`);
    setLastAgentEventAt(Date.now());
    if (notice.category === "write") {
      setCratesDocked((previous) => previous + 1);
    }
  }

  function runScan(reason = "scan", changedFiles = getChangedFiles(), nextSessions = sessionStatesRef.current) {
    const startedAt = Date.now();
    const spec = readSpec();
    if (!spec) return;

    setProjectName(spec.project);

    const { signals } = runAllDetectors();
    const audit = createAudit(signals);
    writeAudit(audit);

    const diff = compareSpec(signals, spec);
    const { newItems, state, readOnly } = computeDrift(diff);
    const unresolvedCount = state.items.filter((item) => item.status === "unresolved").length;

    setSystemCount(diff.aligned.filter((signal) => signal.category === "system").length);
    setDriftCount(unresolvedCount);
    setLastScan(new Date().toLocaleTimeString());
    setLastScanAt(Date.now());
    setMemoryWarnings(getMemoryWarnings(changedFiles));
    syncSessionStates(nextSessions);

    const scanSummary =
      unresolvedCount === 0
        ? "scan clean (0 drift)"
        : `${unresolvedCount} unresolved drift item(s)`;
    if (lastScanHistoryRef.current !== scanSummary || unresolvedCount > 0 || reason === "scan") {
      pushHistory(unresolvedCount === 0 ? "good" : "bad", scanSummary);
      lastScanHistoryRef.current = scanSummary;
    }

    log({
      event: "scan",
      systems_detected: signals.filter((signal) => signal.category === "system").length,
      drift_items: unresolvedCount,
      duration_ms: Date.now() - startedAt,
    });

    // When _drift.yaml failed to load, nothing was persisted, so every scan would report
    // the same violations as "new" again: alerting would loop OS notifications forever,
    // and DriftAlert resolutions could not be saved anyway. Surface state counts only.
    const alertable = readOnly
      ? []
      : newItems.filter(
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

    setFatalError(null);
    const controller = createWatchController({
      onActivityNotice: (notice, nextStates) => {
        applyActivityNotice(notice, nextStates);
      },
      onError: (message) => {
        pushHistory("warn", message);
        setFatalError(message);
      },
      onRepoScan: ({ changedFiles, event, filepath, sessionStates: nextStates }) => {
        runScan(`change (${event})`, changedFiles, nextStates);
      },
      onRepoWarning: (warning) => {
        pushHistory("warn", warning);
      },
      onSessionsChanged: (nextStates) => {
        syncSessionStates(nextStates);
      },
      onSessionWarning: (warning, nextStates) => {
        syncSessionStates(nextStates);
        pushHistory("warn", warning);
      },
    });
    controllerRef.current = controller;
    syncSessionStates(controller.getSessionStates());
    runScan("scan", getChangedFiles(), controller.getSessionStates());
    controller.start();

    return () => {
      void controller.stop();
      controllerRef.current = null;
    };
  }, [exit]);

  function handleAlertResolved() {
    setPendingAlerts((prev) => prev.slice(1));
    const drift = readDrift();
    setDriftCount(drift.items.filter((item) => item.status === "unresolved").length);
  }

  useInput((input) => {
    if (input === "q") {
      void controllerRef.current?.stop();
      exit();
      return;
    }
    if (input === "a") {
      setAnimated((previous) => !previous);
    }
  });

  return (
    <Box flexDirection="column">
      <Logo />

      <Box borderStyle="single" borderColor={theme.border} paddingX={1} justifyContent="space-between">
        <Text>
          <Text bold>{projectName}</Text>
          {"  "}
          <Text color={theme.success}>{systemCount} systems</Text>
          {"  "}
          {driftCount > 0 ? <Text color={theme.warning}>{driftCount} drift</Text> : <Text color={theme.success}>0 drift</Text>}
          {"  "}
          <Text color={theme.agent}>{sessionStates.length} sessions</Text>
        </Text>
        <Text dimColor>Last scan: {lastScan}</Text>
      </Box>

      <MascotLane
        animate={animated && !fatalError}
        crates={cratesDocked}
        drift={driftCount > 0}
        lastAgentEventAt={lastAgentEventAt}
        lastScanAt={lastScanAt}
      />

      {fatalError ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.danger}>
            watch stopped because of a runtime error
          </Text>
          <Text color={theme.danger}>{fatalError}</Text>
          <Text dimColor>Press q to quit, then rerun `tack watch` after fixing the underlying filesystem issue.</Text>
        </Box>
      ) : (
        <>
          {pendingAlerts.length > 0 && pendingAlerts[0] && <DriftAlert item={pendingAlerts[0]} onResolved={handleAlertResolved} />}

          {pendingAlerts.length === 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color={headline.color}>
                {headline.text}
              </Text>
              <Text dimColor>Canonical proof loop: keep watch open, start a labeled MCP session, then look for READY, READ, and WRITE. Press q to quit, a to {animated ? "pause" : "resume"} the deckhand.</Text>
            </Box>
          )}
        </>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Trust Loop</Text>
        <Text color={installVerification.status === "write_seen" ? theme.success : installVerification.status === "read_seen" ? theme.agent : theme.warning}>
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

      {visibleSessions.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Agent Sessions</Text>
          {visibleSessions.map((state) => {
            const display = getMcpSessionDisplayLabel(state, sessionStates);
            const summary = sessionSummary(state);
            return (
              <Box key={state.sessionKey} justifyContent="space-between">
                <Box>
                  <Text color={theme.agent}>{display}</Text>
                  <Text dimColor>  </Text>
                  <Text color={summary.color}>{summary.text}</Text>
                  <Text dimColor>  </Text>
                  <Text dimColor>{healthLabel(state.health)}</Text>
                </Box>
                <Box>
                  <Text dimColor>{formatAge(state.lastEventAt)}</Text>
                  <Text dimColor>  </Text>
                  <Text dimColor>{state.lastMessage}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {memoryWarnings.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warning}>Attention</Text>
          {memoryWarnings.slice(0, 3).map((warning) => (
            <Text key={warning} color={theme.warning}>
              - {warning}
            </Text>
          ))}
        </Box>
      )}

      {history.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Recent Events</Text>
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
      )}

      <Box marginTop={1}>
        <Text dimColor>Useful commands</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {USEFUL_COMMANDS.map((item) => (
          <Text key={item.command}>
            <Text color={theme.success}>{item.command.padEnd(USEFUL_COMMANDS_LABEL_WIDTH)}</Text>
            <Text dimColor>  {item.description}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
