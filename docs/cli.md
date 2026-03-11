# CLI Reference

## `tack init`

- detects architecture signals
- lets you classify systems as allowed, forbidden, or skipped
- writes the initial `.tack/` files

## `tack status`

- runs a one-shot scan
- updates `.tack/_audit.yaml`
- computes drift against your spec

## `tack watch`

- watches the repo for changes
- re-scans on file changes
- creates drift items for new violations, risks, or undeclared systems
- emits MCP activity notices and watch output
- press `q` to quit

## `tack handoff`

- packages context, machine state, and git deltas
- writes `.tack/handoffs/<timestamp>.md`
- writes `.tack/handoffs/<timestamp>.json`
- includes verification steps from `.tack/verification.md`

## `tack log`

View decisions (human/manual path):

```bash
tack log
```

Append a manual decision:

```bash
tack log decision "Use session-first MCP flow" --reason "Keeps startup compact"
```

View recent raw log events (debugging):

```bash
tack log events
tack log events 100
```

## `tack note`

View notes:

```bash
tack note
```

Add a note:

```bash
tack note --message "Detected auth boundary mismatch" --type warning --actor agent:cursor
```

Archive old notes:

```bash
tack note --clear 30
```

## `tack diff`

Compare architecture signals against a base branch:

```bash
tack diff main
```

## `tack mcp`

Start the MCP server:

```bash
tack mcp
```

For the canonical trust-loop path, run it from the repo root with a label:

```bash
TACK_AGENT_NAME=claude tack mcp
```

## `tack setup-agent`

Install or update startup instructions automatically:

```bash
tack setup-agent
tack setup-agent --target claude
tack setup-agent --target cursor
tack setup-agent --list
```

After `tack setup-agent`, use the same proof loop every time:

1. `tack watch`
2. `TACK_AGENT_NAME=<agent> tack mcp`
3. confirm `READY`, then `READ`, then `WRITE`

## `tack help`

Show command help.

## V1 Scope Note

`tack check-in` does not ship as a standalone CLI command in v1.

Use MCP write-back tools such as `checkpoint_work`, `log_decision`, and `log_agent_note` during agent sessions, and use `tack handoff` when you want an explicit end-of-session package.

## Development

```bash
npm run typecheck
npm run test
npm run test:publish
npm run build
```

Optional:

```bash
npm run dev
npm run build:bun
npm run dev:bun
```
