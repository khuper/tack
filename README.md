# tack

[![npm version](https://img.shields.io/npm/v/tack-cli.svg)](https://www.npmjs.com/package/tack-cli) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Tack gives coding agents compact project memory with guardrails and handoffs.

It keeps a shared record in `./.tack/` so a new agent session can start with the smallest useful context instead of re-learning the repo from scratch.

## Install And Prove It Works

1. Install Tack. If you prefer not to install globally, use `npx tack-cli@latest` instead of `tack`.

```bash
npm install -g tack-cli
```

2. Initialize the repo and install your agent startup instructions once.

```bash
tack init
tack setup-agent
```

3. Keep `tack watch` open in a second terminal as live proof.

```bash
tack watch
```

4. Start the MCP server from the repo root with a visible agent label.

```bash
TACK_AGENT_NAME=claude tack mcp
```

If `tack watch` shows `READY`, `READ`, and `WRITE` activity, the agent is actually using Tack.

At the end of a session, package a handoff:

```bash
tack handoff
```

Read the full guides:

- [Getting Started](./docs/getting-started.md)
- [Agent Workflow](./docs/agent-workflow.md)
- [MCP Clients](./docs/mcp-clients.md)
- [Watch Mode](./docs/watch.md)
- [CLI Reference](./docs/cli.md)
- [Detectors And YAML Rules](./docs/detectors.md)

## What Can You Do With Tack?

- Give agents a compact session-start entrypoint with `tack://session`
- Preserve decisions, blockers, discoveries, and partial work across sessions
- Watch live MCP reads and writes so you can tell whether agents are actually using Tack
- Detect architecture drift against a declared spec
- Package handoffs for the next agent or human
- Install startup instructions for supported agents with `tack setup-agent`

## Why Tack Helps

- Agents stop starting cold every time you open a new window
- Architectural guardrails live in one place instead of scattered prompts
- The default workflow stays compact instead of vacuuming the entire repo
- You can see who read context, who wrote memory back, and who may be leaving the next session cold
- Project memory lives in versionable files under `./.tack/`

## Common Workflow

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

`tack watch` is the live proof. If the agent reads `tack://session` or writes memory back, you will see it immediately.

During normal work:

```bash
tack status
tack watch
```

If you use more than one agent, give each MCP server its own `TACK_AGENT_NAME` so `tack watch` can show who read context, who checked rules, and who wrote memory back.

## Example Workflows

### New Agent Session

Open a new agent window in a repo that already uses Tack:

```bash
tack watch
TACK_AGENT_NAME=claude tack mcp
```

The agent reads `tack://session`, sees the current focus and recent work, and starts from the smallest useful context instead of re-learning the repo. `tack watch` shows the read live so you know the agent is grounded in project memory.

### Structural Change

The agent wants to add a dependency or introduce a new boundary.

Instead of guessing, it calls `check_rule` first. That gives a compact yes/no-with-context guardrail check before the architecture changes.

### End Of Session

The agent made changes, found one blocker, and left partial work.

Instead of scattering notes manually, it calls `checkpoint_work` once. Tack saves a summary, discoveries, decisions, and related files so the next session has a usable starting point.

## Learn More

- [Getting Started](./docs/getting-started.md)
- [Agent Workflow](./docs/agent-workflow.md)
- [MCP Clients](./docs/mcp-clients.md)
- [Watch Mode](./docs/watch.md)
- [CLI Reference](./docs/cli.md)
- [Detectors And YAML Rules](./docs/detectors.md)

## Notes

- offline only, no hidden network calls in Tack's project-memory engine
- writes are guarded to `./.tack/`
- Python virtual environments are ignored during scans (`venv`, `.venv`, `site-packages`) to reduce false positives
