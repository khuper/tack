#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import minimist from "minimist";
import { App } from "./App.js";

const args = minimist(process.argv.slice(2));
const command = args._[0] as string | undefined;

const VALID_COMMANDS = ["init", "status", "watch", "help"];

if (!command || command === "help" || args.help) {
  // eslint-disable-next-line no-console
  console.log(`
  tack — Architecture drift guard

  Usage:
    npx tack init      Set up spec.yaml from detected architecture
    npx tack status    Run a scan and show current state
    npx tack watch     Persistent watcher with live drift alerts
    npx tack help      Show this help text

  Files (all in /tack/):
    spec.yaml     Your declared architecture contract
    audit.yaml    Latest detector sweep results
    drift.yaml    Current unresolved drift items
    logs.ndjson   Append-only event log
  `);
  process.exit(0);
}

if (!VALID_COMMANDS.includes(command)) {
  // eslint-disable-next-line no-console
  console.error(`Unknown command: "${command}". Run "npx tack help" for usage.`);
  process.exit(1);
}

render(<App command={command as "init" | "status" | "watch"} />);
