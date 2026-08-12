# MCP Clients

Tack ships an MCP server. Your agent only gets project memory once that server is wired into the client.

The fastest path is checked-in, project-scoped MCP config:

```bash
tack setup-mcp
```

That merges a `tack` server entry into the MCP config files your repo already uses, creates `.mcp.json` if none exist yet, and leaves every other entry in those files untouched. `tack setup-agent` runs the same step by default (pass `--no-mcp` to skip it).

Commit the generated config so every teammate and every fresh clone connects to the same server without manual setup.

## `tack setup-mcp`

```bash
tack setup-mcp                          # update detected clients, else create .mcp.json
tack setup-mcp --client cursor          # one client
tack setup-mcp --client gemini --client codex
tack setup-mcp --all                    # every supported client
tack setup-mcp --runner tack            # use the tack binary instead of npx
tack setup-mcp --windows                # generate the Windows form from macOS or Linux
tack setup-mcp --dry-run                # show what would change
tack setup-mcp --list                   # clients, aliases, and config paths
```

| Client | File | Config key |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `mcpServers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| VS Code / Copilot | `.vscode/mcp.json` | `servers` |
| Gemini CLI | `.gemini/settings.json` | `mcpServers` |
| Codex CLI | `.codex/config.toml` | `[mcp_servers.tack]` |
| opencode | `opencode.json` | `mcp` |

Rules the writer follows:

- only the `tack` entry is created or replaced; sibling servers, unrelated top-level keys, indentation, trailing newline, and CRLF line endings are preserved
- clients are detected by the **config file**, not by the directory: a `.vscode/` or `.cursor/` folder with no `mcp.json` in it is not a signal, and if nothing is detected Tack creates `.mcp.json` for Claude Code
- a config file it cannot parse is never rewritten; the command prints the entry to paste instead and exits non-zero, so a bootstrap script can tell "configured" from "nothing written"
- reruns are idempotent, so `tack setup-mcp` is safe in a bootstrap script

Default server entry (with `--runner npx`, the default):

- command: `npx`
- args: `["-y", "tack-cli", "mcp"]`
- env: `{"TACK_AGENT_NAME": "<client>"}`

With `--runner tack` the entry becomes command `tack`, args `["mcp"]`. Use it when `tack` is installed globally and you want to skip the `npx` resolution step.

### Windows output

On Windows, `npx` and `tack` are `.cmd` shims. MCP clients spawn stdio servers without a
shell, and Node only resolves `.cmd` through `PATHEXT` when a shell is involved, so a bare
`"command": "npx"` fails with `spawn npx ENOENT`. Tack therefore generates a `cmd /c`
wrapper when it runs on `win32`:

```json
{
  "mcpServers": {
    "tack": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "tack-cli", "mcp"],
      "env": { "TACK_AGENT_NAME": "claude" }
    }
  }
}
```

The same wrapping applies to `--runner tack` (`cmd /c tack mcp`), to the opencode `command`
array, and to the Codex TOML block. By default the output depends on the machine that ran
the command, so on a mixed-platform team pick one form for the checked-in config and
generate it deterministically from any machine with `--platform win32` or
`--platform posix` (`--windows` remains an alias for `--platform win32`). Most teams
should commit the POSIX form and have Windows users rely on WSL, or commit the Windows
form only when the whole team is on Windows.

### Working directory

Tack resolves the project from `.tack/` upward from the server's working directory, and
falls back to that directory when it finds none. No generated entry sets `cwd`, so the
client must start the server at the repo root that contains `.tack/` - open the project at
its root rather than at a subfolder. If your client launches servers from somewhere else,
add an explicit working directory yourself: VS Code, Codex, and Gemini CLI all accept a
`cwd` field, and VS Code and Cursor expand `${workspaceFolder}` inside it.

## Claude Code

`tack setup-mcp --client claude` writes:

```json
{
  "mcpServers": {
    "tack": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tack-cli", "mcp"],
      "env": { "TACK_AGENT_NAME": "claude" }
    }
  }
}
```

`.mcp.json` is project scope: it is meant to be committed, and Claude Code asks each user to approve the server the first time they open the project. Run `/mcp` to confirm the connection.

Per-user fallback, if you would rather not commit config:

```bash
claude mcp add --transport stdio tack -- env TACK_AGENT_NAME=claude npx -y tack-cli mcp
```

On Windows, use `cmd` plus the `.cmd` shim instead of `env`:

```bash
claude mcp add --transport stdio tack -- cmd /c "set TACK_AGENT_NAME=claude&& npx -y tack-cli mcp"
```

`env` is a Unix command, and PowerShell may block the `tack.ps1` shim, so `cmd /c` is the safer default on Windows.

## Cursor

`tack setup-mcp --client cursor` writes `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tack": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tack-cli", "mcp"],
      "env": { "TACK_AGENT_NAME": "cursor" }
    }
  }
}
```

Cursor uses `mcpServers` and documents `"type": "stdio"` for local servers. `${workspaceFolder}` is available if you need an absolute path to a local build:

```json
{
  "mcpServers": {
    "tack": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js", "mcp"],
      "env": { "TACK_AGENT_NAME": "cursor" }
    }
  }
}
```

On Windows the generated entry is `cmd /c npx -y tack-cli mcp` (see [Windows output](#windows-output)); never a bare `npx`, and never shell-style `env TACK_AGENT_NAME=... tack mcp`. Cursor sets env vars directly through the `env` field.

Restart Cursor after changing MCP config.

## VS Code / Copilot

`tack setup-mcp --client vscode` (aliases: `code`, `copilot`) writes `.vscode/mcp.json`:

```json
{
  "servers": {
    "tack": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tack-cli", "mcp"],
      "env": { "TACK_AGENT_NAME": "copilot" }
    }
  }
}
```

VS Code uses `servers`, not `mcpServers`, and takes an explicit `type` for stdio servers. Copying a Cursor or Claude Code block verbatim is the most common setup mistake here. `cwd` and `envFile` are also accepted and expand `${workspaceFolder}`.

If your `.vscode/mcp.json` contains comments, Tack will not rewrite it. It prints the `tack` member on its own for you to paste into the existing `servers` object, and exits non-zero.

Start the server from the MCP view or the `MCP: List Servers` command, then check Copilot agent mode for the `tack` tools.

## Gemini CLI

`tack setup-mcp --client gemini` writes `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "tack": {
      "command": "npx",
      "args": ["-y", "tack-cli", "mcp"],
      "env": { "TACK_AGENT_NAME": "gemini" }
    }
  }
}
```

Project settings live in `.gemini/settings.json` and are merged with `~/.gemini/settings.json`, so other keys in that file are preserved. Gemini CLI reads `GEMINI.md` for startup instructions; run `tack setup-agent --target gemini` to install the Tack block there.

Verify with `/mcp` inside Gemini CLI.

## Codex CLI

`tack setup-mcp --client codex` writes `.codex/config.toml`:

```toml
[mcp_servers.tack]
command = "npx"
args = ["-y", "tack-cli", "mcp"]
env = { TACK_AGENT_NAME = "codex" }
```

Codex uses the snake_case table `mcp_servers`, not `mcpServers`.

Project-scoped `.codex/config.toml` is only loaded for trusted projects. If the server never starts, trust the project (`trust_level = "trusted"` for this project in `~/.codex/config.toml`) or move the block into `~/.codex/config.toml`.

Tack parses the whole file before touching it and replaces only the `[mcp_servers.tack]` table and its subtables, in place. It refuses to write - printing the block to paste instead - when the file does not parse as TOML, when the tack server is declared as a dotted key or inline table (`mcp_servers.tack = { ... }`, or `tack = { ... }` under `[mcp_servers]`), or when it is declared in more than one place. Rewrite those forms as a plain `[mcp_servers.tack]` table and rerun.

Per-user fallback on macOS/Linux:

```bash
codex mcp add tack -- env TACK_AGENT_NAME=codex npx -y tack-cli mcp
```

On Windows:

```bash
codex mcp add tack -- cmd /c "set TACK_AGENT_NAME=codex&& npx -y tack-cli mcp"
```

Verify with `codex mcp get tack` or `codex mcp list`, and start Codex from the project root (`codex` or `codex -C /path/to/your/project`).

## opencode

`tack setup-mcp --client opencode` writes `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tack": {
      "type": "local",
      "command": ["npx", "-y", "tack-cli", "mcp"],
      "enabled": true,
      "environment": { "TACK_AGENT_NAME": "opencode" }
    }
  }
}
```

opencode uses `mcp` (not `mcpServers`), a single `command` array instead of `command` plus `args`, `environment` instead of `env`, and needs `"type": "local"` plus `"enabled": true`.

opencode also accepts `opencode.jsonc`. If `opencode.jsonc` is your only config file, Tack treats it as your config: it will not rewrite it (it may contain comments) and it will not create a competing `opencode.json` — paste the `tack` entry in manually. If both files exist, Tack writes `opencode.json` (the file opencode loads first) and leaves the `.jsonc` untouched.

## Other clients

Any MCP client can run the server directly:

```bash
TACK_AGENT_NAME=<agent> tack mcp
```

or, without a global install:

```bash
TACK_AGENT_NAME=<agent> npx -y tack-cli mcp
```

Always start it from the repo root that contains `.tack/`.

## Agent Identity

The `TACK_AGENT_NAME` label written into every generated config is what `tack watch` shows when an agent reads context, checks a rule, or writes memory back.

If your MCP client provides neither `TACK_AGENT_NAME` nor `initialize.clientInfo.name`, call `register_agent_identity` once near session start. That gives the current session a stable label without overloading `get_briefing` or requiring manual log edits.

## Session Continuity

Tack treats MCP identity and MCP session ids as separate things:

- `TACK_AGENT_NAME` is the strongest identity source and is set for you by `tack setup-mcp`.
- If `TACK_AGENT_NAME` is missing, Tack falls back to `initialize.clientInfo.name`. Handshake names containing `codex`, `claude`/`claude code`, `cursor`, `gemini`, `opencode`, `copilot`, `cline`, `roo`, `windsurf`, `continue`, `zed`, or `amp` are normalized to a short label; anything else is slugified as-is. VS Code identifies itself as `Visual Studio Code`, which slugifies to `visual-studio-code` rather than `copilot` - another reason to let `tack setup-mcp` set `TACK_AGENT_NAME`.
- If both are missing, the session shows up as `unknown` until you call `register_agent_identity`.

In `tack watch`, this means:

- `connected to Tack MCP` means the agent label is known and this is the first visible session for that agent.
- `reconnected to Tack MCP (new session)` means the same labeled agent started a fresh MCP session, usually after a mode/model switch or client restart.
- `connected (new session; identity unknown)` means the transport is live, but Tack still needs a stable label.

The recommended order is:

1. run `tack setup-mcp` so `TACK_AGENT_NAME` is in the checked-in MCP config
2. rely on client handshake identity when the client already identifies itself clearly
3. call `register_agent_identity` once at session start only as a fallback

Canonical watch proof:

```text
[READY][claude] connected to Tack MCP
[READ][claude] read session context
[WRITE][claude] checkpointed work
```

If the same agent reconnects with a new MCP session, watch will say `reconnected to Tack MCP (new session)` instead of looking silent or broken.

## Resources

- `tack://session` - read this first in every session
- `tack://context/workspace` - compact workspace snapshot with guardrails, detected systems, unresolved drift, and changed files
- `tack://context/facts` - implementation facts and `spec.yaml`
- `tack://context/intent` - north star, focus, goals, questions, recent decisions
- `tack://context/decisions_recent` - recent decisions only
- `tack://context/machine_state` - raw `_audit.yaml` and `_drift.yaml`
- `tack://handoff/latest` - latest handoff (served inside the untrusted-context wrapper; read as text, not parseable JSON)

## Tools

- `get_briefing` - low-token session-start briefing
- `check_rule` - mid-task guardrail check before structural changes
- `register_agent_identity` - explicit session labeling fallback when the client does not identify itself
- `checkpoint_work` - default end-of-work write-back
- `log_decision` - record a single decision without a full checkpoint
- `log_agent_note` - record a narrow discovery or warning without a full checkpoint
