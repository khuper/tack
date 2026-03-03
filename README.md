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
