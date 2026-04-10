# tack

[![npm version](https://img.shields.io/npm/v/tack-cli.svg)](https://www.npmjs.com/package/tack-cli) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Tack gives your agents a shared memory for the repo, so each new session can pick up where the last one left off.

Static instruction files go out of date as soon as the code changes. Tack keeps a shared record in `./.tack/` and checks that memory against the codebase, so the next agent starts with context that still matches reality.

## Install

1. Install Tack. If you prefer not to install globally, use `npx tack-cli@latest` instead of `tack`.

```bash
npm install -g tack-cli
```

2. Initialize the repo and install your agent startup instructions once.

```bash
tack init
tack setup-agent
```

3. Keep `tack watch` open in a second terminal so you can see what the agent is doing.

```bash
tack watch
```

4. Start the MCP server from the repo root with a visible agent label.

```bash
TACK_AGENT_NAME=claude tack mcp
```

On Windows PowerShell, set the label like this instead:

```powershell
$env:TACK_AGENT_NAME="claude"
tack.cmd mcp
```

5. Check `tack watch` for these events:

- `READY` means the MCP session connected
- `READ` means the agent read `tack://session` or another Tack context resource
- `WRITE` means the agent wrote memory back with `checkpoint_work`, `log_decision`, or `log_agent_note`

If you see `READY`, `READ`, and `WRITE`, the agent is actually using Tack.

When you wrap up a session, create a handoff:

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
- Show when agents are reading current context and writing memory back
- Carry context across sessions with handoffs and MCP context resources

## Why This Matters

- The bigger problem is stale context, not just missing context
- Every repeated question like "what framework are we using?" is a context failure
- Drift detection helps keep Tack honest when the code has changed
- Decisions explain why the system looks the way it does before the agent asks
- Handoffs let context survive session boundaries without another interview

## Typical Workflow

Initialize Tack once at the repo root:

```bash
tack init
```

Install agent instructions once per repo:

```bash
tack setup-agent
```

When you connect an agent, run:

```bash
tack watch
TACK_AGENT_NAME=claude tack mcp
```

On Windows PowerShell:

```powershell
tack watch
$env:TACK_AGENT_NAME="claude"
tack.cmd mcp
```

`tack watch` shows whether the agent connected, read context, and wrote work back. The usual flow is `READY`, then `READ`, then `WRITE`.

Example:

```text
[READY][claude] connected to Tack MCP
[READ][claude] read session context
[WRITE][claude] checkpointed work
```

There is no standalone `tack check-in` command in v1. Write-back happens through MCP tools like `checkpoint_work`, plus `tack handoff`.

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

On Windows PowerShell:

```powershell
tack watch
$env:TACK_AGENT_NAME="claude"
tack.cmd mcp
```

The agent reads `tack://session`, sees the current focus and recent work, and starts with current context instead of re-learning the repo. `tack watch` shows that read as it happens, so you can tell the agent is working from real project memory.

### Structural Change

The agent wants to add a dependency or introduce a new boundary.

Instead of guessing from old instructions, it calls `check_rule` first. That gives a quick guardrail check before the architecture changes.

### End Of Session

The agent made changes, found one blocker, and left partial work.

Instead of making the next session piece things together, it calls `checkpoint_work` once. Tack saves a summary, discoveries, decisions, and related files so the next session can pick up quickly.

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
