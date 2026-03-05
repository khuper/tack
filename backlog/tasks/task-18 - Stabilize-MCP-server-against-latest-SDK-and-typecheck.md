---
id: TASK-18
title: Stabilize MCP server against latest SDK and typecheck
status: To Do
assignee: []
created_date: '2026-03-05 15:32'
labels:
  - mcp
  - typecheck
dependencies: []
references:
  - src/mcp.ts
  - README.md
  - .tack/context.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the MCP server implementation in `src/mcp.ts` to target the current `@modelcontextprotocol/sdk` API, ensure it compiles without being excluded from `tsconfig.json`, and add tests that assert MCP resources/tools are thin wrappers over deterministic engine functions and respect write-back boundaries for `.tack/`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `src/mcp.ts` compiles against the pinned `@modelcontextprotocol/sdk` version without being excluded from `tsconfig.json`, and `npx tsc --noEmit` passes on a clean clone.
- [ ] #2 MCP resources (`tack://context/intent`, `.../facts`, `.../machine_state`, `.../decisions_recent`, `tack://handoff/latest`) call existing deterministic engine/file functions instead of duplicating logic.
- [ ] #3 MCP tools (`log_decision`, `log_agent_note`) only write to documented append targets (`.tack/decisions.md`, `.tack/_notes.ndjson`) and test coverage explicitly asserts that attempts to write machine-managed files (`_audit.yaml`, `_drift.yaml`, `_logs.ndjson`) are rejected or never performed.
<!-- AC:END -->

