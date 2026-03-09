#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink";
import minimist from "minimist";
import { App } from "./App.js";
import { usePlainOutput } from "./lib/tty.js";
import { runStatusScan } from "./engine/status.js";
import { printStatusPlain } from "./plain/status.js";
import { generateHandoff } from "./engine/handoff.js";
import { printHandoffPlain } from "./plain/handoff.js";
import { runInitPlain } from "./plain/init.js";
import { runWatchPlain } from "./plain/watch.js";
import { log, readRecentLogs } from "./lib/logger.js";
import { appendDecision, normalizeDecisionActor, readDecisionsMarkdown } from "./engine/decisions.js";
import { ensureTackIntegrity } from "./lib/files.js";
import { readSpecWithError, specExists } from "./lib/files.js";
import { getDefaultCommand } from "./lib/cli.js";
import { printNotes, addNotePlain } from "./plain/notes.js";
import { compactNotes } from "./lib/notes.js";
import { runDiffPlain } from "./plain/diff.js";
import { formatMissingTackContextMessage, tackDirExists } from "./lib/files.js";
import { resolveAnimationsEnabled } from "./lib/animation.js";
import { readPackageMeta } from "./lib/packageMeta.js";

const ASCII_LOGO = `
 ████████╗ █████╗  ██████╗██╗  ██╗
 ╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝
    ██║   ███████║██║     █████╔╝
    ██║   ██╔══██║██║     ██╔═██╗
    ██║   ██║  ██║╚██████╗██║  ██╗
    ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
`;

import updateNotifier from "update-notifier";

const pkg = readPackageMeta();
const args = minimist(process.argv.slice(2));
const rawCommand = args._[0] as string | undefined;
const shouldCheckForUpdates =
  rawCommand !== "mcp" &&
  Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI);

if (shouldCheckForUpdates) {
  updateNotifier({ pkg }).notify();
}

if (args.version || args.v) {
  // eslint-disable-next-line no-console
  console.log(pkg.version);
  process.exit(0);
}

const command = rawCommand ?? getDefaultCommand();

const VALID_COMMANDS = ["init", "status", "watch", "handoff", "log", "note", "diff", "mcp", "help"] as const;
type Command = (typeof VALID_COMMANDS)[number];

function isValidCommand(value: string): value is Command {
  return (VALID_COMMANDS as readonly string[]).includes(value);
}

if (command === "help" || args.help || args.h) {
  // eslint-disable-next-line no-console
  console.log(`
${ASCII_LOGO}
  tack — Architecture drift guard

  Usage:
    npx tack init [--ink]          Set up spec.yaml from detected architecture
    npx tack status [--ink]        Run a scan and show current state
    npx tack watch [--plain]       Persistent watcher with live drift alerts
    npx tack handoff [--ink]       Generate agent handoff artifacts
    npx tack log                   View or append decisions
    npx tack log events [N]        Show last N log events (default 50)
    npx tack note                  View/add agent notes
    npx tack diff <base-branch>    Compare architecture vs base branch (plain)
    npx tack mcp                   Start MCP server (for Cursor / agent integrations)
    npx tack help                  Show this help text

  Output mode:
    default: plain output for all commands except watch
    --ink: force Ink UI for init/status/handoff
    --plain or TACK_PLAIN=1: force plain output (including watch)
    --no-animations or TACK_ANIMATIONS=off: start watch mascot in static mode

  Files (all in .tack/):
    spec.yaml     Your declared architecture contract
    _audit.yaml   Latest detector sweep results
    _drift.yaml   Current unresolved drift items
    _logs.ndjson  Append-only event log
    context.md, goals.md, assumptions.md, open_questions.md
    handoffs/<ts>.md, handoffs/<ts>.json

  Project root:
    Existing Tack project: nearest ancestor directory that contains .tack/
    New project: cd to the intended project root, then run "tack init"
  `);
  process.exit(0);
}

if (!isValidCommand(command)) {
  // eslint-disable-next-line no-console
  console.error(`Unknown command: "${command}". Run "npx tack help" for usage.`);
  process.exit(1);
}

const normalizedCommand = command;
const commandsRequiringExistingTack = new Set<Command>(["status", "watch", "handoff", "log", "note", "diff", "mcp"]);

if (commandsRequiringExistingTack.has(normalizedCommand) && !tackDirExists()) {
  // eslint-disable-next-line no-console
  console.error(formatMissingTackContextMessage(normalizedCommand));
  process.exit(1);
}

// tack mcp: start the MCP server (stdio). Run from a project root that has .tack/
if (normalizedCommand === "mcp") {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const mcpHere = path.join(dir, "mcp.js");
  const mcpInDist = path.join(dir, "..", "dist", "mcp.js");
  const mcpPath = existsSync(mcpHere) ? mcpHere : mcpInDist;
  if (!existsSync(mcpPath)) {
    // eslint-disable-next-line no-console
    console.error("MCP server not found. Run `npm run build` in the tack repo first.");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [mcpPath], { stdio: "inherit", cwd: process.cwd() });
  process.exit(result.status ?? 1);
}
const forcePlain = usePlainOutput();
const forceInk = Boolean(args.ink || process.argv.includes("--ink"));
const animationsEnabled = resolveAnimationsEnabled(args);

const shouldUseInk =
  normalizedCommand === "watch" ? !forcePlain : forceInk && !forcePlain;

function printFatal(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (normalizedCommand === "status" || normalizedCommand === "watch" || normalizedCommand === "handoff") {
  if (specExists()) {
    const { error } = readSpecWithError();
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`⚠ ${error}`);
      // eslint-disable-next-line no-console
      console.error("Fix .tack/spec.yaml syntax and run again.");
      process.exit(1);
    }
  }
  let repaired: string[] = [];
  try {
    repaired = ensureTackIntegrity().repaired;
  } catch (err) {
    printFatal(err);
  }
  if (repaired.length > 0) {
    log({ event: "repair", files: repaired });
    // eslint-disable-next-line no-console
    console.log(`Repaired .tack integrity: ${repaired.join(", ")}`);
  }
}

if (normalizedCommand === "log") {
  const sub = args._[1] as string | undefined;
  if (!sub) {
    // eslint-disable-next-line no-console
    console.log(readDecisionsMarkdown());
    process.exit(0);
  }

  if (sub === "events") {
    const rawLimit = args._[2] as string | undefined;
    let limit = 50;
    if (typeof rawLimit === "string") {
      const parsed = Number.parseInt(rawLimit, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
    }

    const events = readRecentLogs(limit);
    if (!events.length) {
      // eslint-disable-next-line no-console
      console.log("No log events recorded.");
      process.exit(0);
    }

    for (const event of events) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(event));
    }
    process.exit(0);
  }

  if (sub !== "decision") {
    // eslint-disable-next-line no-console
    console.error(
      `Unknown log subcommand: "${sub}". Use "tack log", "tack log decision", or "tack log events [N]".`
    );
    process.exit(1);
  }

  const decisionText = args._.slice(2).join(" ").trim();
  const reasonText = String(args.reason ?? "").trim();
  if (!decisionText) {
    // eslint-disable-next-line no-console
    console.error('Missing decision text. Usage: tack log decision "Decision" --reason "Reason"');
    process.exit(1);
  }
  if (!reasonText) {
    // eslint-disable-next-line no-console
    console.error('Missing reason. Usage: tack log decision "Decision" --reason "Reason"');
    process.exit(1);
  }

  try {
    appendDecision(decisionText, reasonText);
    log({
      event: "decision",
      decision: decisionText,
      reasoning: reasonText,
      actor: normalizeDecisionActor(typeof args.actor === "string" ? args.actor : undefined),
    });
  } catch (err) {
    printFatal(err);
  }

  // eslint-disable-next-line no-console
  console.log("Decision logged.");
  process.exit(0);
}

if (normalizedCommand === "note") {
  const hasMessage = typeof args.message === "string" && args.message.trim().length > 0;
  const hasClear = args.clear !== undefined;

  if (hasMessage && hasClear) {
    // eslint-disable-next-line no-console
    console.error('Cannot use --message and --clear together. Use either "tack note --message ..." or "tack note --clear N".');
    process.exit(1);
  }

  if (!hasMessage && !hasClear) {
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const type = typeof args.type === "string" ? args.type : undefined;
    printNotes({ limit, type });
    process.exit(0);
  }

  if (hasMessage) {
    const type = typeof args.type === "string" ? args.type : "discovered";
    const actor = typeof args.actor === "string" ? args.actor : "user";
    const ok = addNotePlain(type, String(args.message), actor);
    if (ok) {
      // eslint-disable-next-line no-console
      console.log("Note added.");
    }
    process.exit(ok ? 0 : 1);
  }

  if (hasClear) {
    const raw = args.clear;
    const days =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : NaN;
    if (!Number.isFinite(days) || days <= 0) {
      // eslint-disable-next-line no-console
      console.error('Invalid value for --clear. Expected a positive number of days, e.g. "tack note --clear 30".');
      process.exit(1);
    }
    const archived = compactNotes(days);
    // eslint-disable-next-line no-console
    console.log(`Archived ${archived} notes older than ${days} days.`);
    process.exit(0);
  }
}

if (!shouldUseInk) {
  if (normalizedCommand === "init") {
    try {
      process.exit((await runInitPlain()) ? 0 : 1);
    } catch (err) {
      printFatal(err);
    }
  }

  if (normalizedCommand === "status") {
    const result = runStatusScan();
    if (!result) {
      // eslint-disable-next-line no-console
      console.error("No spec.yaml found. Run 'tack init' first.");
      process.exit(1);
    }
    printStatusPlain(result.status);
    process.exit(0);
  }

  if (normalizedCommand === "handoff") {
    try {
      const generated = generateHandoff();
      log({
        event: "handoff",
        markdown_path: generated.markdownPath,
        json_path: generated.jsonPath,
      });
      printHandoffPlain(generated.markdownPath, generated.jsonPath, generated.report.generated_at);
      process.exit(0);
    } catch (err) {
      printFatal(err);
    }
  }

  if (normalizedCommand === "watch") {
    try {
      await runWatchPlain();
      process.exit(0);
    } catch (err) {
      printFatal(err);
    }
  }

  if (normalizedCommand === "diff") {
    try {
      const baseBranch = args._[1] as string | undefined;
      const ok = runDiffPlain(baseBranch);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      printFatal(err);
    }
  }
}

render(<App command={normalizedCommand as "init" | "status" | "watch" | "handoff"} animationsEnabled={animationsEnabled} />);
