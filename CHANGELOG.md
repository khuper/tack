# Changelog

## Unreleased

- Fixed changed-file detection for non-ASCII paths: git's default `core.quotePath` returned `café.ts` as the literal `"caf\303\251.ts"`, so the file that actually changed dropped out of drift detection, handoff `related files`, and status while an unresolvable path was reported in its place. All path listings now use `-z` and split on NUL, which also disambiguates paths containing a newline.
- Hardened the `.tack/` write boundary: the `.tack/` and `.tack/handoffs/` roots must now be real directories (a checked-in `.tack -> .git` symlink can no longer redirect writes), NDJSON rotation refuses any symlink, and all state files are written atomically (temp file + rename) so a crash or concurrent reader never sees a torn file.
- Hardened the untrusted-content sanitizer: lone CR / CRLF can no longer forge line structure inside the `<untrusted_project_context>` wrapper, and the invisible-character strip now also covers U+061C, variation selectors (U+FE00-FE0F, U+E0100-E01EF), and the Hangul fillers.
- Made drift state loss-proof: a `_drift.yaml` that fails to parse or contains entries a given Tack version cannot represent is quarantined and never rewritten (accepted/rejected resolutions survive), the corrupt-file warning fires once per process instead of per scan, watch mode stops looping notifications while the file is unreadable, and drift auto-dismissals from older versions migrate to the reopenable `disappeared` status.
- Added project-scoped MCP config generation (`tack setup-mcp`, and `tack setup-agent` by default) for Claude Code, Cursor, VS Code/Copilot, Gemini CLI, Codex CLI, and opencode, with surgical JSON/TOML merging that preserves unrelated keys, comments-bearing `.jsonc` files, indentation, dominant line endings, and a leading UTF-8 BOM; filesystem errors on one client downgrade to a pasteable snippet instead of aborting the batch, and config writes are atomic.
- Added `--platform win32|posix` to `setup-agent`/`setup-mcp` so mixed-platform teams can generate either command form deterministically (`--windows` remains an alias).
- MCP server modernization: tool annotations and titles, `outputSchema`/`structuredContent` on every tool, server `instructions`, and client identity resolved after `initialize` so clientInfo-derived agent names are honored. `get_briefing`/`check_rule` no longer claim `readOnlyHint` (they append to `.tack/` logs and stats).
- Declared the `zod` runtime dependency, moved to `@modelcontextprotocol/sdk` ^1.30, raised `engines.node` to >=20, and reconciled the stale `bun.lock`.

## 0.1.3 - 2026-03-11

- Tightened the trust-loop release story around one canonical proof path: run `tack setup-agent`, keep `tack watch` open, start a labeled MCP session with `TACK_AGENT_NAME=... tack mcp`, and confirm `READY`, `READ`, then `WRITE`.
- Made watch semantics easier to trust during reconnects: same-agent new sessions now show `reconnected to Tack MCP (new session)` instead of looking like silent disconnects.
- Unified plain and Ink watch around the same shared session controller so MCP activity, repo-change warnings, inactivity handling, and scan triggers stay behaviorally aligned.
- Clarified the first-run agent flow in the docs: run `tack setup-agent`, start the MCP server with `TACK_AGENT_NAME=... tack mcp`, and keep `tack watch` open as live proof that the agent actually used Tack.
- Updated package metadata to describe Tack as accurate project memory for coding agents with guardrails and handoffs.
- Added explicit install verification in `tack watch`: waiting for first agent read, successful `tack://session` read, and first memory write-back.
- Reworked `tack setup-agent` into an idempotent installer: `tack setup-agent` now bootstraps or updates supported agent files by default, resolves clean aliases like `cursor`, reports `installed` / `updated` / `unchanged`, and avoids partial writes when a target file is malformed.
