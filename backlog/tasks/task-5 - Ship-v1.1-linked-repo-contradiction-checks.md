---
id: TASK-5
title: Ship v1.1 linked repo contradiction checks
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
Support `linked_repos` in `.tack/spec.yaml` and read sibling repos to detect obvious architecture contradictions (e.g., GraphQL vs REST mismatch). Keep local/offline behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `linked_repos` schema is documented and parsed
- [ ] #2 `tack status` flags contradictions across linked repos
<!-- AC:END -->
