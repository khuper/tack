# MCP Clients

Run the MCP server from the project root:

```bash
tack mcp
```

Tack reads `.tack/` from the current working directory, so always start the MCP server from the repo root that contains `.tack/`.

If you want `tack watch` to distinguish multiple agents, start each MCP server with a label:

```bash
TACK_AGENT_NAME=claude tack mcp
TACK_AGENT_NAME=codex tack mcp
TACK_AGENT_NAME=cursor tack mcp
```

That label is written into MCP activity logs so `tack watch` can show which agent read context, checked a rule, or wrote memory back.

## Cursor

Add an MCP server with:

- command: `tack`
- args: `["mcp"]`
- cwd: your project root
- env: `{"TACK_AGENT_NAME":"cursor"}`

If `tack` is not on PATH, use:

- command: `node`
- args: `["/path/to/tack/dist/index.js", "mcp"]`
- cwd: your project root
- env: `{"TACK_AGENT_NAME":"cursor"}`

Restart Cursor after changing MCP config.

## Codex CLI

With `tack` on PATH:

```bash
codex mcp add tack -- env TACK_AGENT_NAME=codex tack mcp
```

With a local build:

```bash
codex mcp add tack -- env TACK_AGENT_NAME=codex node /path/to/tack/dist/index.js mcp
```

Verify:

```bash
codex mcp get tack
codex mcp list
```

Start Codex from the project root:

```bash
cd /path/to/your/project
codex
```

Or:

```bash
codex -C /path/to/your/project
```

## Claude Code

With `tack` on PATH:

```bash
claude mcp add --transport stdio tack-mcp -- env TACK_AGENT_NAME=claude tack mcp
```

With `npx`:

```bash
claude mcp add --transport stdio tack-mcp -- env TACK_AGENT_NAME=claude npx tack-cli mcp
```

On Windows native PowerShell, use:

```bash
claude mcp add --transport stdio tack-mcp -- cmd /c "set TACK_AGENT_NAME=claude && npx tack-cli mcp"
```

Then run `/mcp` in Claude Code to confirm the server is connected.

If you run more than one agent against the same repo, give each one a distinct label. `tack watch` will then show activity like:

- who read `tack://session`
- who checked `check_rule`
- who called `checkpoint_work`
- which agent is still waiting on write-back

## Resources

- `tack://session` - read this first in every session
- `tack://context/workspace` - compact workspace snapshot with guardrails, detected systems, unresolved drift, and changed files
- `tack://context/facts` - implementation facts and `spec.yaml`
- `tack://context/intent` - north star, focus, goals, questions, recent decisions
- `tack://context/decisions_recent` - recent decisions only
- `tack://context/machine_state` - raw `_audit.yaml` and `_drift.yaml`
- `tack://handoff/latest` - latest handoff JSON

## Tools

- `get_briefing` - low-token session-start briefing
- `check_rule` - mid-task guardrail check before structural changes
- `checkpoint_work` - default end-of-work write-back
- `log_decision` - record a single decision without a full checkpoint
- `log_agent_note` - record a narrow discovery or warning without a full checkpoint
