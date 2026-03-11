---
id: TASK-18
title: Stabilize MCP server contract and SDK coverage
status: In Progress
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
Keep the MCP server aligned with the pinned `@modelcontextprotocol/sdk`, verify that it stays part of the normal build/typecheck path, and tighten contract tests around the MCP resources and write-back tools that now define the primary product workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/mcp.ts` compiles against the pinned `@modelcontextprotocol/sdk` version without being excluded from `tsconfig.json`, and normal build/typecheck paths include it.
- [ ] #2 MCP session-start resources and tools (`tack://session`, `tack://context/workspace`, `get_briefing`) plus the remaining context resources call existing deterministic engine/file functions instead of duplicating logic.
- [ ] #3 MCP write-back tools (`checkpoint_work`, `log_decision`, `log_agent_note`) only write to documented append targets and test coverage explicitly asserts they do not mutate machine-managed files such as `_audit.yaml`, `_drift.yaml`, or `_logs.ndjson`.
<!-- AC:END -->
