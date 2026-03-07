---
id: TASK-24
title: Review MCP CLI and watch experience
status: In Progress
assignee: []
created_date: '2026-03-07 20:35'
updated_date: '2026-03-07 20:53'
labels:
  - review
  - mcp
  - cli
  - ux
dependencies: []
references:
  - src/index.tsx
  - src/mcp.ts
  - src/plain/watch.ts
  - src/plain/init.ts
  - src/plain/status.ts
  - src/plain/handoff.ts
  - src/plain/notes.ts
  - src/plain/diff.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review the command surface and MCP server from an operator-experience perspective. Focus on confusing messages, bad defaults, missing guardrails, MCP contract sharp edges, watch-mode noise, and places where behavior is technically correct but hard to trust.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP, CLI, and plain-output flows have a review pass with actionable findings
- [ ] #2 High-friction UX or contract issues are fixed or split into targeted follow-up tasks
- [ ] #3 Tests cover any behavior changes in command routing or MCP integration
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review pass 2026-03-07 focused on MCP/watch behavior. Shipped work:

- watch mode now surfaces MCP resource/tool activity so users can see live agent interaction
- duplicate monitor logic was consolidated into a shared MCP activity monitor
- repeated MCP reads in tight bursts are suppressed to reduce watch noise
- NDJSON monitoring was optimized from repeated recent-history rescans to an incremental tail reader
- Node tests now cover MCP activity formatting/suppression and NDJSON tail behavior

Remaining scope for this task: broader review of the non-watch plain command surface (`init`, `status`, `handoff`, `notes`, `diff`) and any additional MCP contract sharp edges outside the activity/logging path.
<!-- SECTION:NOTES:END -->
