import { runStatusScan } from "../engine/status.js";
import {
  getMcpInstallVerification,
  getMcpSessionDisplayLabel,
  type McpActivityNotice,
  type McpSessionState,
} from "../lib/logger.js";
import { getWatchScanSummary } from "../lib/watch.js";
import { createWatchController } from "../lib/watchController.js";
import { blue, checkBadge, gray, green, mcpBadge, red, yellow } from "./colors.js";

function printSnapshot(reason: string, result = runStatusScan()): boolean {
  if (!result) {
    console.error("No spec.yaml found. Run 'tack init' first.");
    return false;
  }

  const ts = new Date().toISOString();
  const healthy = result.status.health === "aligned";
  console.log(
    `${checkBadge()} ${blue(`[${ts}]`)} ${yellow(reason)} :: health=${healthy ? green("aligned") : red("drift")} drift=${
      result.status.driftCount > 0 ? red(String(result.status.driftCount)) : green("0")
    }`
  );
  for (const item of result.status.driftItems.slice(0, 5)) {
    console.log(`  - ${red(item.system)}: ${item.message}`);
  }
  if (result.status.driftItems.length > 5) {
    console.log(`  - ${gray(`...and ${result.status.driftItems.length - 5} more`)}`);
  }
  return true;
}

function printWatchGuide(): void {
  console.log(gray("Watch answers four questions: did the agent connect, read context, write memory back, or leave anything risky behind?"));
  console.log("");
}

function printInstallVerification(sessions: McpSessionState[]): void {
  const verification = getMcpInstallVerification(sessions);
  console.log(gray("Install verification:"));
  console.log(
    verification.status === "waiting_for_first_read"
      ? `${mcpBadge()}  [WAIT] ${yellow("waiting for first agent read")}`
      : `${mcpBadge()}  [OK] ${green("agent read tack://session")}${verification.readLabel ? gray(` via ${verification.readLabel}`) : ""}`
  );
  console.log(
    verification.status === "write_seen"
      ? `${mcpBadge()}  [OK] ${green("agent wrote memory back")}${gray(` via ${verification.writeLabel}`)}`
      : `${mcpBadge()}  [WAIT] ${yellow("waiting for first memory write-back")}`
  );
  console.log("");
}

function printMcpNotice(notice: McpActivityNotice, sessions: McpSessionState[]): void {
  const state = sessions.find((candidate) => candidate.sessionKey === notice.sessionKey);
  const label = state ? getMcpSessionDisplayLabel(state, sessions) : notice.agent;
  console.log(`${mcpBadge()}  [${notice.category.toUpperCase()}][${label}] ${gray(notice.message)}`);
}

function getWatchErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runWatchPlain(): Promise<void> {
  const ok = printSnapshot("initial");
  if (!ok) return;

  let sessionStates: McpSessionState[] = [];
  let errorMessage: string | null = null;
  let lastSnapshotSummary = "initial";

  const controller = createWatchController({
    handleProcessSignals: true,
    onActivityNotice: (notice, nextStates) => {
      sessionStates = nextStates;
      printMcpNotice(notice, sessionStates);
      if (
        (notice.event.event === "mcp:resource" && notice.event.resource === "tack://session") ||
        (notice.event.event === "mcp:tool" && notice.category === "write")
      ) {
        printInstallVerification(sessionStates);
      }
    },
    onError: (message) => {
      errorMessage = message;
    },
    onRepoScan: ({ event, filepath }) => {
      const result = runStatusScan();
      if (!result) {
        errorMessage = "No spec.yaml found. Run 'tack init' first.";
        void controller.stop();
        return;
      }

      const summary = getWatchScanSummary(result.status.health, result.status.driftCount);
      if (summary !== lastSnapshotSummary || result.status.driftCount > 0) {
        lastSnapshotSummary = summary;
        printSnapshot(`${event} ${filepath}`, result);
      }
    },
    onRepoWarning: (warning, nextStates) => {
      sessionStates = nextStates;
      console.log(`${mcpBadge()}  [WARN][repo] ${gray(warning)}`);
    },
    onSessionsChanged: (nextStates) => {
      sessionStates = nextStates;
    },
    onSessionWarning: (warning, nextStates) => {
      sessionStates = nextStates;
      console.log(`${mcpBadge()}  [WARN][session] ${gray(warning)}`);
    },
  });
  sessionStates = controller.getSessionStates();
  printWatchGuide();
  printInstallVerification(sessionStates);
  console.log(`${gray("Watching for changes and MCP activity (plain mode). Press Ctrl+C to stop.")}`);
  controller.start();
  await controller.waitUntilStopped();
  console.log(gray("Stopped watch mode."));
  if (errorMessage) {
    throw new Error(getWatchErrorMessage(errorMessage));
  }
}
