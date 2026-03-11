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

If your MCP client provides neither `TACK_AGENT_NAME` nor `initialize.clientInfo.name`, call `register_agent_identity` once near session start. That gives the current session a stable label without overloading `get_briefing` or requiring manual log edits.

## Session Continuity

Tack treats MCP identity and MCP session ids as separate things:

- `TACK_AGENT_NAME` is the strongest identity source and should be set whenever your client allows custom env vars.
- If `TACK_AGENT_NAME` is missing, Tack falls back to `initialize.clientInfo.name` and normalizes common clients like Codex, Claude Code, and Cursor automatically.
- If both are missing, the session shows up as `unknown` until you call `register_agent_identity`.

In `tack watch`, this means:

- `connected to Tack MCP` means the agent label is known and this is the first visible session for that agent.
- `reconnected to Tack MCP (new session)` means the same labeled agent started a fresh MCP session, usually after a mode/model switch or client restart.
- `connected (new session; identity unknown)` means the transport is live, but Tack still needs a stable label.

The recommended order is:

1. set `TACK_AGENT_NAME` in MCP config
2. rely on client handshake identity when the client already identifies itself clearly
3. call `register_agent_identity` once at session start only as a fallback

Canonical watch proof:

```text
[READY][claude] connected to Tack MCP
[READ][claude] read session context
[WRITE][claude] checkpointed work
```

If the same agent reconnects with a new MCP session, watch will say `reconnected to Tack MCP (new session)` instead of looking silent or broken.

## Cursor

Add an MCP server with:

- command: `tack`
- args: `["mcp"]`
- cwd: your project root
- env: `{"TACK_AGENT_NAME":"cursor"}`

On Windows, prefer:

- command: `tack.cmd`
- args: `["mcp"]`
- cwd: your project root
- env: `{"TACK_AGENT_NAME":"cursor"}`

If you want the most reliable Windows setup, use the absolute `.cmd` path from your global npm bin directory.

If `tack` is not on PATH, use:

- command: `node`
- args: `["/path/to/tack/dist/index.js", "mcp"]`
- cwd: your project root
- env: `{"TACK_AGENT_NAME":"cursor"}`

Avoid shell-style commands like `env TACK_AGENT_NAME=... tack mcp` in Windows configs. Cursor can set env vars directly, so use the `env` field instead.

Restart Cursor after changing MCP config.

## Codex CLI

On macOS/Linux, with `tack` on PATH:

```bash
codex mcp add tack -- env TACK_AGENT_NAME=codex tack mcp
```

On Windows, use `cmd` plus the `.cmd` shim:

```bash
codex mcp add tack -- cmd /c "set TACK_AGENT_NAME=codex&& tack.cmd mcp"
```

If you want the most reliable Windows setup, use absolute paths:

```bash
codex mcp add tack -- "C:\Windows\System32\cmd.exe" /c "set TACK_AGENT_NAME=codex&& C:\Users\you\AppData\Roaming\npm\tack.cmd mcp"
```

With a local build on macOS/Linux:

```bash
codex mcp add tack -- env TACK_AGENT_NAME=codex node /path/to/tack/dist/index.js mcp
```

With a local build on Windows:

```bash
codex mcp add tack -- cmd /c "set TACK_AGENT_NAME=codex&& node C:\path\to\tack\dist\index.js mcp"
```

Do not use `env TACK_AGENT_NAME=...` on Windows. `env` is a Unix command, and PowerShell may also block the `tack.ps1` shim. `tack.cmd` avoids that execution-policy failure.

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

On macOS/Linux, with `tack` on PATH:

```bash
claude mcp add --transport stdio tack-mcp -- env TACK_AGENT_NAME=claude tack mcp
```

With `npx` on macOS/Linux:

```bash
claude mcp add --transport stdio tack-mcp -- env TACK_AGENT_NAME=claude npx tack-cli mcp
```

On Windows native PowerShell, use `cmd` plus the `.cmd` shim:

```bash
claude mcp add --transport stdio tack-mcp -- cmd /c "set TACK_AGENT_NAME=claude&& tack.cmd mcp"
```

If you prefer `npx` on Windows:

```bash
claude mcp add --transport stdio tack-mcp -- cmd /c "set TACK_AGENT_NAME=claude&& npx tack-cli mcp"
```

Do not use `env TACK_AGENT_NAME=...` on Windows. `env` is Unix-only, and PowerShell may block the `tack.ps1` shim. `tack.cmd` is the safer default on Windows.

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
- `register_agent_identity` - explicit session labeling fallback when the client does not identify itself
- `checkpoint_work` - default end-of-work write-back
- `log_decision` - record a single decision without a full checkpoint
- `log_agent_note` - record a narrow discovery or warning without a full checkpoint
