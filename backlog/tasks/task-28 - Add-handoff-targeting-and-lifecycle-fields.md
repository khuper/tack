---
id: TASK-28
title: Add handoff targeting and lifecycle fields
status: Done
assignee: []
created_date: '2026-03-11 16:06'
updated_date: '2026-03-30 15:32'
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
- [x] #1 Generated handoff JSON includes stable identity and lifecycle fields that can represent an unclaimed handoff plus later pickup/working states.
- [x] #2 `tack handoff` can optionally set an intended recipient or role (for example `--to developer`) and that value is persisted in the handoff artifact.
- [x] #3 Existing handoff readers tolerate older handoff files that do not yet contain the new fields.
- [x] #4 The schema and lifecycle meanings are documented clearly enough to support future A2A/task-routing work.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as a top-level `handoff` metadata block with stable `id`, optional `to`, and lifecycle fields (`status`, `created_at`, `updated_at`, `pickup_at`, `pickup_by`). `tack://handoff/latest` now normalizes older handoff JSON so pre-lifecycle artifacts remain readable through the canonical MCP path.
<!-- SECTION:NOTES:END -->
