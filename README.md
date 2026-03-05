# tack

Architecture drift guard. Declare your spec. Tack enforces it.

## What It Does

`tack` scans your codebase for architecture signals (framework, auth, DB, payments, scope patterns, risks), compares them against your declared contract, and tracks drift over time.

All tool state lives in `./.tack/`:

- `spec.yaml` — declared architecture contract
- `_audit.yaml` — latest scan result
- `_drift.yaml` — unresolved/accepted/rejected drift items
- `_logs.ndjson` — append-only event log
- `context.md` / `goals.md` / `assumptions.md` / `open_questions.md` — context templates
- `verification.md` — validation/verification steps to run after changes (tests, linters, health checks)

Agents and tools consume this state via:

- The `tack-mcp` server (Model Context Protocol), which exposes read-only resources for context, guardrails, and the latest handoff JSON, plus tools for logging decisions and agent notes.
- Direct file access to `.tack/`, where human-authored docs and handoffs live alongside machine-managed state.

## Install

```bash
bun install
bun run build
```

Optional global/local CLI use:

```bash
npm pack
# then install the tarball in another project if desired
```

## Usage

From any project directory:

```bash
bun run /absolute/path/to/tack/dist/index.js init
bun run /absolute/path/to/tack/dist/index.js status
bun run /absolute/path/to/tack/dist/index.js watch
bun run /absolute/path/to/tack/dist/index.js handoff
```

Within the `tack` repo itself:

```bash
bun run src/index.tsx help
```

## Using Tack with Agents

Tack treats LLM agents as **clients of a deterministic engine**. Agents should read context from `.tack/` and write back through the documented channels instead of mutating machine-managed files directly.

### MCP (Model Context Protocol)

Run the MCP server:

```bash
bun run src/mcp.ts
```

The server (`tack-mcp`) exposes these key resources:

- `tack://context/intent` – `context.md`, `goals.md`, `open_questions.md`, `decisions.md`
- `tack://context/facts` – `implementation_status.md` and `spec.yaml`
- `tack://context/machine_state` – `_audit.yaml` and `_drift.yaml`
- `tack://context/decisions_recent` – recent decisions as markdown
- `tack://handoff/latest` – latest handoff JSON (`.tack/handoffs/*.json`)

And these tools for write-back:

- `log_decision` – append a decision to `.tack/decisions.md` and log a `decision` event
- `log_agent_note` – append an agent note to `.tack/_notes.ndjson`

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
  - Append decisions to `.tack/decisions.md`: `- [YYYY-MM-DD] Decision — reason`
  - Use the CLI to log notes: `tack note --message "..." --type discovered --actor agent:cursor`
  - Or append NDJSON lines manually to `.tack/_notes.ndjson` if the CLI is not available

Do **not** modify `.tack/_drift.yaml`, `.tack/_audit.yaml`, or `.tack/_logs.ndjson` directly; they are machine-managed.

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
bun run typecheck
bun test
bun run build
```

## Notes

- Offline-only (no network calls)
- Writes are guarded to `./.tack/` only
- Python virtual environments are ignored during scans (`venv`, `.venv`, `site-packages`) to avoid false positives
