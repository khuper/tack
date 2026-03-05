---
id: TASK-1
title: Stabilize power mode output parity
status: To Do
assignee: []
created_date: '2026-03-03 23:19'
labels: []
dependencies: []
references:
  - .tack/context.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Harden power mode commands (`init`, `status`, `watch`, `handoff`, `log`) so plain and Ink outputs are consistent and deterministic across runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All five commands produce deterministic output for same repo state
- [ ] #2 Plain and Ink modes have parity for core status/handoff information
<!-- AC:END -->
