---
id: TASK-5
title: Ship linked-repo contradiction checks for cross-repo context
status: To Do
assignee: []
created_date: '2026-03-03 23:19'
labels: []
dependencies: []
references:
  - .tack/context.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Support `linked_repos` in `.tack/spec.yaml` and read sibling repos to detect obvious contradictions in architecture or project context for multi-repo automation workflows, while keeping the behavior local and offline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `linked_repos` schema is documented and parsed
- [ ] #2 `tack status` or equivalent context surfaces flag contradictions across linked repos
<!-- AC:END -->
