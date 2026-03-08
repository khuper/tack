import chokidar from "chokidar";
import * as path from "node:path";
import { logsPath } from "../lib/files.js";
import { runStatusScan } from "../engine/status.js";
import { createMcpActivityMonitor } from "../lib/logger.js";
import { blue, checkBadge, gray, green, mcpBadge, red, yellow } from "./colors.js";

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

function printSnapshot(reason: string): boolean {
  const result = runStatusScan();
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

export async function runWatchPlain(): Promise<void> {
  const ok = printSnapshot("initial");
  if (!ok) return;

  console.log(`${gray("Watching for changes and MCP activity (plain mode). Press Ctrl+C to stop.")}`);

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
  const readNewMcpActivity = createMcpActivityMonitor();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const shutdown = async (): Promise<void> => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await watcher.close();
    await logsWatcher.close();
    console.log(gray("Stopped watch mode."));
  };

  logsWatcher.on("change", () => {
    for (const notice of readNewMcpActivity()) {
      console.log(`${mcpBadge()} ${blue(`[${notice.event.ts}]`)} ${gray(notice.message)}`);
    }
  });

  watcher.on("all", (event, filepath) => {
    if (filepath.includes(`${path.sep}.tack${path.sep}`)) return;
    if (filepath.startsWith(".tack/") || filepath.startsWith(".tack\\")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      printSnapshot(`${event} ${filepath}`);
    }, 300);
  });

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      void shutdown().then(resolve);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
