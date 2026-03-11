# Getting Started

Tack gives coding agents project memory that stays accurate across sessions.

Static setup files go stale the moment the code changes. Tack keeps a shared record of your architecture, decisions, notes, drift, and handoffs in `./.tack/`, then checks that memory against the codebase so the next session starts from context that is still trustworthy.

## Install

Install globally:

```bash
npm install -g tack-cli
```

Or run without installing:

```bash
npx tack-cli@latest init
```

## First Run

Initialize Tack in your project:

```bash
tack init
```

Install startup instructions once so your agent actually starts with Tack context:

```bash
tack setup-agent
```

Start `tack watch` in a second terminal so you can see live proof when the agent connects:

```bash
tack watch
```

Then start the MCP server from the repo root with a visible agent label:

```bash
TACK_AGENT_NAME=claude tack mcp
```

That first-run loop is the trust check: `tack setup-agent` installs the startup instructions, `TACK_AGENT_NAME` labels the connected agent session, and `tack watch` shows live proof that the agent actually read or wrote Tack memory.

At the end of a session, package a handoff:

```bash
tack handoff
```

## Common Workflow

The goal is simple: stop re-explaining the same codebase facts every time a new agent session starts.

Initialize Tack once at the repo root:

```bash
tack init
```

Install agent instructions once per repo:

```bash
tack setup-agent
```

Use this first-run proof loop when wiring up an agent:

```bash
tack watch
TACK_AGENT_NAME=claude tack mcp
```

`tack watch` is the live proof. If the agent reads `tack://session`, checks a rule, or writes memory back, you will see it.

During normal work:

```bash
tack status
tack watch
```

If you use more than one agent, give each MCP server its own `TACK_AGENT_NAME` so `tack watch` can show who read context, who checked rules, and who wrote memory back.

## What Tack Stores

All state lives in `./.tack/`:

- `spec.yaml` - your declared architecture contract
- `context.md`, `goals.md`, `assumptions.md`, `open_questions.md` - human-written intent and constraints
- `implementation_status.md` - current implementation facts
- `decisions.md` - append-only decision history
- `_notes.ndjson` - timestamped agent notes
- `_audit.yaml` - latest detector sweep used to verify context against the codebase
- `_drift.yaml` - unresolved, accepted, or rejected mismatches between memory and reality
- `_logs.ndjson` - append-only event stream
- `handoffs/*.md` and `handoffs/*.json` - handoff packages for the next session
- `verification.md` - verification steps included in handoffs

## Project Root Rules

Tack looks for the nearest ancestor directory that contains `.tack/` and treats that as the project root.

This means you can run `tack status`, `tack watch`, `tack handoff`, `tack log`, `tack note`, `tack diff`, and `tack mcp` from subdirectories inside an initialized project.

If no `.tack/` exists in the current directory or any parent, Tack does not guess a sibling project. Run it from the repo you actually want, or initialize a new project there:

```bash
cd /path/to/your/project
tack init
```

Legacy migration from `./tack/` to `./.tack/` only happens when that directory looks like old Tack state, not when it is just a folder named `tack`.

## Next

- [Agent Workflow](./agent-workflow.md)
- [MCP Clients](./mcp-clients.md)
- [Watch Mode](./watch.md)
- [CLI Reference](./cli.md)
- [Detectors And YAML Rules](./detectors.md)
