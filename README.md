# tack

[![npm version](https://img.shields.io/npm/v/tack-cli.svg)](https://www.npmjs.com/package/tack-cli) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Architecture drift guard. You declare the spec; Tack checks your code against it.

## Why Tack

`tack` keeps a single, shared picture of your architecture and how it changes over time.

It gives agents and humans a shared project memory that survives across sessions:

- Captures your intended architecture in `spec.yaml` and a small set of context docs.
- Detects architecture signals in code and tracks drift from the spec over time.
- Generates handoff artifacts (`.md` + canonical `.json`) for the next agent or session.
- Preserves machine history in append-only logs instead of ad-hoc console output.
- Records explicit decisions and notes so future sessions can see why changes happened.

## Persistent Context in `.tack/`

All Tack state lives in `./.tack/`, so you can stop and resume work (or swap agents) without losing context:

- `context.md`, `goals.md`, `assumptions.md`, `open_questions.md` – human-written intent and constraints.
- `decisions.md` – append-only decision history with a short reason for each choice.
- `_notes.ndjson` – timestamped agent notes between sessions (newline-delimited JSON).
- `spec.yaml` – your architecture contract: allowed/forbidden systems, constraints, optional `domains` map.
- `_audit.yaml` – latest detector snapshot of what the codebase actually does.
- `_drift.yaml` – unresolved/accepted/rejected drift items between spec and reality.
- `_logs.ndjson` – append-only machine event stream (what Tack saw and when).
- `handoffs/*.md` and `handoffs/*.json` – handoff packages for the next session.
- `verification.md` – validation steps that get pulled into handoffs.

Agents and tools read and write this state in two main ways:

- Through the `tack-mcp` server (Model Context Protocol), which exposes typed context resources and safe write-back tools.
- By reading and appending to files under `.tack/`, where human-authored docs and machine-managed state live side by side.

## Change Tracking Workflow

- `tack status` runs a scan, updates `_audit.yaml`, and computes drift against your spec.
- `tack watch` continuously rescans on file changes and appends events to `_logs.ndjson`.
- `tack handoff` packages context + machine state + git deltas for the next session.
- `tack log` and `tack note` store decisions and notes that future agents and humans can reuse.

## Install from npm

Use Tack in any project without cloning:

**Run without installing (npx):**

```bash
npx tack-cli init
npx tack-cli status
npx tack-cli handoff
```

**Or install in your project (local):**

```bash
npm install tack-cli
npx tack-cli init
# or: ./node_modules/.bin/tack init
```

**Or install globally:**

```bash
npm install -g tack-cli
tack init
tack status
tack handoff
```

> **Note:** If global install on Windows fails with `EEXIST` or cleanup errors, remove any existing `tack` or `tack-cli` in `npm root -g`, or use `npx tack-cli` instead.

## Build from source

To develop or contribute:

```bash
npm install
npm run build
```

Optional global link for local development:

```bash
npm link
# now `tack` is available globally on this machine
```

Or package for use in another project:

```bash
npm pack
# then install the tarball in another project if desired
```

## Usage

From any project directory:

```bash
node /absolute/path/to/tack/dist/index.js init
node /absolute/path/to/tack/dist/index.js status
node /absolute/path/to/tack/dist/index.js watch
node /absolute/path/to/tack/dist/index.js handoff
node /absolute/path/to/tack/dist/index.js mcp
```

Within the `tack` repo itself:

```bash
node dist/index.js help
```

## `tack watch` Preview

![tack watch terminal preview](./tackpreview.png)

## Typical Multi-Session Loop

```bash
# Session start
tack status

# During work
tack watch

# Record key intent changes
tack log
tack note

# Session end
tack handoff
```

## Using Tack with Agents

Tack exposes a small, deterministic engine that agents call into (same inputs → same outputs, no hidden network calls). Agents should read context from `.tack/` and write back only through the documented channels instead of editing machine-managed files directly.

### MCP (Model Context Protocol)

**Run the MCP server:** From a project that has `.tack/`, run:

```bash
tack mcp
```

If `tack` is on your PATH (for example after `npm install -g tack-cli` or `npm link` from the Tack repo), that’s all you need. Or run `node /path/to/tack/dist/index.js mcp`. The server reads `.tack/` from the current working directory, so always run it from your **project root**.

**Cursor:** In Cursor (Settings → Tools & MCP), add an MCP server with command `tack`, args `["mcp"]`, and **cwd** set to your project root (the directory that contains `.tack/`). If `tack` isn’t on PATH, use command `node` with args `["/path/to/tack/dist/index.js", "mcp"]`, cwd = project root. Restart Cursor after changing MCP config.

**Codex CLI:** Add the Tack MCP server to Codex:

```bash
# With tack-cli on PATH (for example after npm install -g tack-cli)
codex mcp add tack -- tack mcp

# With a local build of this repo
codex mcp add tack -- node /path/to/tack/dist/index.js mcp
```

Then verify it:

```bash
codex mcp get tack
codex mcp list
```

Tack reads `.tack/` from the current working directory, and Codex launches MCP servers relative to the Codex session cwd. Start Codex from your **project root** (the directory that contains `.tack/`), for example:

```bash
cd /path/to/your/project
codex
```

Or:

```bash
codex -C /path/to/your/project
```

If you update Tack from source, rebuild it with `npm run build` so `dist/index.js` stays current.

**Claude Code:** From your project root (the directory that contains `.tack/`), add the Tack MCP server:

```bash
# With tack-cli on PATH (e.g. npm install -g tack-cli)
claude mcp add --transport stdio tack-mcp -- tack mcp

# With npx (no global install)
claude mcp add --transport stdio tack-mcp -- npx tack-cli mcp
```

On **Windows (native, not WSL)** use the `cmd /c` wrapper for npx:

```bash
claude mcp add --transport stdio tack-mcp -- cmd /c npx tack-cli mcp
```

Then run `/mcp` in Claude Code to confirm the server is connected. Tack reads `.tack/` from the current working directory, so open your project folder in Claude Code so the server runs with the correct cwd.

The server (`tack-mcp`) exposes these key resources:

- `tack://context/intent` – `context.md`, `goals.md`, `open_questions.md`, `decisions.md`
- `tack://context/facts` – `implementation_status.md` and `spec.yaml`
- `tack://context/machine_state` – `_audit.yaml` and `_drift.yaml`
- `tack://context/decisions_recent` – recent decisions as markdown
- `tack://handoff/latest` – latest handoff JSON (`.tack/handoffs/*.json`)

And these tools for safe write-back:

- `log_decision` – appends a decision to `.tack/decisions.md` and logs a `decision` event
- `log_agent_note` – appends an agent note to `.tack/_notes.ndjson`

### Direct File Access

Agents without MCP should:

- **Read**:
  - `.tack/spec.yaml` — architecture guardrails
  - `.tack/context.md`, `.tack/goals.md`, `.tack/assumptions.md`, `.tack/open_questions.md`
  - `.tack/implementation_status.md`
  - `.tack/_audit.yaml`, `.tack/_drift.yaml`
  - `.tack/verification.md` — validation/verification steps to run after changes
  - `.tack/handoffs/*.json`, `.tack/handoffs/*.md`
  - `.tack/_notes.ndjson` — agent working notes (NDJSON)
- **Write back**:
  - Append decisions to `.tack/decisions.md` in this format: `- [YYYY-MM-DD] Decision — reason`
  - Prefer the CLI for notes: `tack note --message "..." --type discovered --actor agent:cursor`
  - If the CLI is not available, append NDJSON lines manually to `.tack/_notes.ndjson`

Do **not** modify `.tack/_drift.yaml`, `.tack/_audit.yaml`, or `.tack/_logs.ndjson` directly; they are machine-managed and may be overwritten at any time.

## Detectors and YAML rules

Detection is **YAML-driven**. Bundled rules live in `src/detectors/rules/*.yaml` and ship with the CLI. At runtime Tack also loads any `*.yaml` from `.tack/detectors/` so projects can add or override detectors.

Each rule file uses this schema:

- **Top-level:** `name`, `displayName`, `signalId`, `category` (`system` | `scope` | `risk`).
- **`systems`:** list of entries, each with:
  - `id` — system identifier (for example `nextjs`, `prisma`, `stripe`)
  - `packages` — npm package names that imply this system
  - `configFiles` — config files to look for (for example `next.config.js`)
  - `directories` — optional directories (for example `src/jobs`)
  - `routePatterns` — optional regex strings to grep in project files

If any of `packages` / `configFiles` / `directories` / `routePatterns` match for a system, one signal is emitted (confidence 1). Invalid YAML or bad regex is skipped without failing the scan. The only detectors still implemented in TypeScript are `multiuser`, `admin`, and `duplicates`; all other primary systems (framework, auth, db, payments, background_jobs, exports) are defined in YAML.

## Commands

### `init`

- Runs a detector sweep
- Prompts you to classify detected systems as allowed/forbidden/skip
- Writes initial files under `./.tack/`

### `status`

- Runs a one-shot scan
- Updates `./.tack/_audit.yaml`
- Computes drift and prints summary

### `watch`

- Starts persistent file watching
- Re-scans on file changes
- Creates drift items for new violations/risks/undeclared systems
- Sends OS notifications for violations and risks
- Press `q` to quit

### `handoff`

- Reads context docs + current machine state
- Reads file-level git changes
- Writes `./.tack/handoffs/<timestamp>.md`
- Writes `./.tack/handoffs/<timestamp>.json` (canonical)
- Includes a **Validation / Verification** section driven by `.tack/verification.md`:
  - Each bullet/numbered item becomes a `verification.steps` entry in JSON and a markdown bullet
  - Intended for humans or external tools to know which commands/checks to run after applying the handoff
  - Tack does **not** execute these commands automatically

## Keyboard Controls

In selection prompts (`init`, drift options):

- `↑` / `↓` to move
- `Enter` to confirm

## Development

```bash
npm run typecheck
bun test
npm run dev
```

Optional Bun fast path for build contributors:

```bash
npm run build:bun
```

Optional Bun source-run for contributors who have Bun:

```bash
npm run dev:bun
```

## Notes

- Offline-only (no network calls)
- Writes are guarded to `./.tack/` only
- Python virtual environments are ignored during scans (`venv`, `.venv`, `site-packages`) to avoid false positives
