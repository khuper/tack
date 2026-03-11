# Changelog

## 0.1.3 - 2026-03-11

- Tightened the trust-loop release story around one canonical proof path: run `tack setup-agent`, keep `tack watch` open, start a labeled MCP session with `TACK_AGENT_NAME=... tack mcp`, and confirm `READY`, `READ`, then `WRITE`.
- Made watch semantics easier to trust during reconnects: same-agent new sessions now show `reconnected to Tack MCP (new session)` instead of looking like silent disconnects.
- Unified plain and Ink watch around the same shared session controller so MCP activity, repo-change warnings, inactivity handling, and scan triggers stay behaviorally aligned.
- Clarified the first-run agent flow in the docs: run `tack setup-agent`, start the MCP server with `TACK_AGENT_NAME=... tack mcp`, and keep `tack watch` open as live proof that the agent actually used Tack.
- Updated package metadata to describe Tack as accurate project memory for coding agents with guardrails and handoffs.
- Added explicit install verification in `tack watch`: waiting for first agent read, successful `tack://session` read, and first memory write-back.
- Reworked `tack setup-agent` into an idempotent installer: `tack setup-agent` now bootstraps or updates supported agent files by default, resolves clean aliases like `cursor`, reports `installed` / `updated` / `unchanged`, and avoids partial writes when a target file is malformed.
