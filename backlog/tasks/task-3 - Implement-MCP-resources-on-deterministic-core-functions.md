---
id: TASK-3
title: Implement MCP resources on deterministic core functions
status: In Progress
assignee: []
created_date: '2026-03-03 23:19'
updated_date: '2026-03-03 23:59'
labels: []
dependencies: []
references:
  - .tack/context.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose MCP resources as thin interfaces over the same deterministic functions used by power mode to preserve one-engine/two-steering-wheels architecture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP handlers call existing deterministic engine functions
- [ ] #2 Behavior and output contracts match power mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-03-03: MCP server is implemented in src/mcp.ts with resources (intent, facts, machine_state, decisions_recent, handoff/latest) and tools (log_decision, log_agent_note). Tool write-back uses existing core functions (appendDecision/log/addNote), but resources still compose data mostly via direct file reads; parity with power-mode output contracts is not explicitly tested.
<!-- SECTION:NOTES:END -->
