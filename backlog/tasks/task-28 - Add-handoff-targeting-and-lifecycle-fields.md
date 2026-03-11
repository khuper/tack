---
id: TASK-28
title: Add handoff targeting and lifecycle fields
status: To Do
assignee: []
created_date: '2026-03-11 16:06'
labels:
  - handoff
  - mcp
  - a2a
dependencies: []
references:
  - src/engine/handoff.ts
  - src/lib/signals.ts
  - docs/agent-workflow.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend Tack handoff JSON from a passive artifact into a directed work item with lightweight lifecycle metadata.

Add fields such as a stable handoff id, intended recipient/role (`to`), lifecycle status (`open`, `picked_up`, `working`, `superseded`, `done`), and pickup metadata. This keeps the implementation local and file-based while establishing the state model needed for `tack resume` and later A2A-style task handoff flows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generated handoff JSON includes stable identity and lifecycle fields that can represent an unclaimed handoff plus later pickup/working states.
- [ ] #2 `tack handoff` can optionally set an intended recipient or role (for example `--to developer`) and that value is persisted in the handoff artifact.
- [ ] #3 Existing handoff readers tolerate older handoff files that do not yet contain the new fields.
- [ ] #4 The schema and lifecycle meanings are documented clearly enough to support future A2A/task-routing work.
<!-- AC:END -->
