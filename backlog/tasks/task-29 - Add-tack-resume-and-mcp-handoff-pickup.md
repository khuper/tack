---
id: TASK-29
title: Add tack resume and MCP handoff pickup
status: To Do
assignee: []
created_date: '2026-03-11 16:06'
labels:
  - handoff
  - cli
  - mcp
  - trust
dependencies:
  - TASK-28
references:
  - src/index.tsx
  - src/engine/handoff.ts
  - src/mcp.ts
  - docs/cli.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an explicit resume/pickup path so agents and humans do not need to know to inspect `.tack/handoffs/` manually.

The CLI should gain `tack resume`, and MCP should gain a matching pickup/resume tool that reads the latest relevant handoff, loads it as active context, and marks it as picked up. This closes the loop that `tack handoff` opens and establishes the submitted -> working state transition needed for later agent-to-agent workflows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `tack resume` can pick the latest open handoff by default and can filter by handoff id and/or intended role.
- [ ] #2 MCP exposes a matching handoff pickup/resume tool for clients that want the same behavior without shelling out to the CLI.
- [ ] #3 Picking up a handoff updates lifecycle metadata to show that it was claimed, by whom, and when.
- [ ] #4 Watch/logging surfaces can show that a handoff was picked up instead of leaving the lifecycle invisible.
- [ ] #5 Regression coverage exists for latest-hand-off selection, role filtering, and pickup state transitions.
<!-- AC:END -->
