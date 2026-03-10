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

View decisions:

```bash
tack log
```

Append a decision:

```bash
tack log decision "Use session-first MCP flow" --reason "Keeps startup compact"
```

View recent log events:

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

## `tack setup-agent`

Install startup instructions for a supported agent:

```bash
tack setup-agent --target claude
tack setup-agent --target codex
tack setup-agent --target generic
```

## `tack help`

Show command help.

## Development

```bash
npm run typecheck
npm run test
npm run build
```

Optional:

```bash
npm run dev
npm run build:bun
npm run dev:bun
```
