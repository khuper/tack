# tack

[![npm version](https://img.shields.io/npm/v/tack-cli.svg)](https://www.npmjs.com/package/tack-cli) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Tack gives your agents persistent project memory that stays accurate instead of going stale.

Static instruction files drift the moment the code changes. Tack keeps a shared record in `./.tack/` and checks that memory against the actual codebase, so the next agent starts from context that is still trustworthy.

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

- [Product Direction](./docs/product-direction.md)
- [Getting Started](./docs/getting-started.md)
- [Agent Workflow](./docs/agent-workflow.md)
- [MCP Clients](./docs/mcp-clients.md)
- [Watch Mode](./docs/watch.md)
- [CLI Reference](./docs/cli.md)
- [Detectors And YAML Rules](./docs/detectors.md)

## What Tack Actually Does

- Keep implementation facts aligned with the real codebase
- Stop stale project instructions from misleading the next agent
- Preserve decisions, blockers, discoveries, and partial work across sessions
- Show live proof that agents are reading current context and writing memory back
- Carry context across session boundaries with handoffs and MCP startup resources

## Why This Matters

- The real failure mode is stale context, not just missing context
- Every repeated question like "what framework are we using?" is a context failure
- Drift detection keeps Tack from lying to the next agent when the code has changed
- Decisions explain why the system looks the way it does before the agent asks
- Handoffs let context survive session boundaries without another interview

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

`tack watch` is the live proof. If the agent reads `tack://session`, checks a rule, or writes memory back, you will see it immediately.

v1 does not ship a standalone `tack check-in` command. Write-back stays behind MCP tools like `checkpoint_work` plus `tack handoff`.

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

The agent reads `tack://session`, sees the current focus and recent work, and starts from maintained context instead of re-learning the repo. `tack watch` shows the read live so you know the agent is grounded in current project memory.

### Structural Change

The agent wants to add a dependency or introduce a new boundary.

Instead of guessing from stale instructions, it calls `check_rule` first. That gives a compact yes/no-with-context guardrail check before the architecture changes.

### End Of Session

The agent made changes, found one blocker, and left partial work.

Instead of making the next session reconstruct what happened, it calls `checkpoint_work` once. Tack saves a summary, discoveries, decisions, and related files so the next session inherits usable context immediately.

## Learn More

- [Product Direction](./docs/product-direction.md)
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
