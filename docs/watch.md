# Watch Mode

`tack watch` keeps two loops visible while work is happening:

- file changes -> rescan architecture and drift
- MCP activity -> show when agent sessions read context, check rules, and write memory back

## Start Watch

```bash
tack watch
```

If you want watch to distinguish multiple concurrent agents, start each MCP server with a label:

```bash
TACK_AGENT_NAME=claude tack mcp
TACK_AGENT_NAME=codex tack mcp
```

## What Watch Shows

`tack watch` shows:

- fresh scans when files change
- drift status against your declared spec
- MCP `READY`, `READ`, `CHECK`, and `WRITE` activity
- per-session state for active agent sessions
- warnings when work may not be getting written back

## Why This Matters

The trust loop is:

1. the agent reads Tack context before acting
2. the agent writes memory back after acting

Reads tell you the agent is grounding itself in project memory.
Writes tell you the next session will not start cold.

## Session Labels

Watch groups MCP activity by session.

If two sessions of the same agent are active at once, watch adds a short suffix so you can tell them apart.

Examples:

- `claude`
- `codex`
- `claude#1a2b`

## Warnings

Watch warns when the risky combination happens:

- an agent session read context
- repo changes happened afterward
- no write-back has happened yet
- the session goes idle or stale

That is the case most likely to leave the next session cold.

## Typical Live Signals

- `READY` - an MCP session connected
- `READ` - an agent read context such as `tack://session`
- `CHECK` - an agent called `check_rule`
- `WRITE` - an agent called `checkpoint_work`, `log_decision`, or `log_agent_note`
- `WARN` - a session may be leaving work behind without preserving memory

## Best Practice

Run `tack watch` in a second terminal whenever agents are working in the repo.

That gives you live proof that:

- agents are actually using Tack context
- rule checks are happening before structural changes
- meaningful work is getting written back
