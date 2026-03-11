# Changelog

## Unreleased

- Clarified the first-run agent flow in the docs: run `tack setup-agent`, start the MCP server with `TACK_AGENT_NAME=... tack mcp`, and keep `tack watch` open as live proof that the agent actually used Tack.
- Updated package metadata to describe Tack as compact project memory for coding agents with guardrails and handoffs.
- Added explicit install verification in `tack watch`: waiting for first agent read, successful `tack://session` read, and first memory write-back.
- Reworked `tack setup-agent` into an idempotent installer: `tack setup-agent` now bootstraps or updates supported agent files by default, resolves clean aliases like `cursor`, reports `installed` / `updated` / `unchanged`, and avoids partial writes when a target file is malformed.
