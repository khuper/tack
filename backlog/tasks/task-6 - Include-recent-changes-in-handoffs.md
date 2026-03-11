---
id: TASK-6
title: Surface recent work context in session and handoff outputs
status: In Progress
assignee: []
created_date: '2026-03-03 23:19'
labels: []
dependencies: []
references:
  - src/engine/memory.ts
  - src/engine/handoff.ts
  - tests/engine/handoff.test.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surface compact recent-work context for the next automated session, not just static project state.

Baseline support already exists for recent decisions, changed files, open drift, notes, and verification steps. Remaining work is to decide whether an explicit recent-work summary should be surfaced in `tack://session`, workspace snapshots, handoffs, or some combination of those outputs without bloating them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Session-start and/or handoff outputs include a compact recent-work summary that helps the next session understand what changed without reading the whole repo
- [ ] #2 Recent-work signals remain source-traceable and deterministic
<!-- AC:END -->
