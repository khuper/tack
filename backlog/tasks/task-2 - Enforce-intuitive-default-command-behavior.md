---
id: TASK-2
title: Enforce intuitive default command behavior
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
Ensure `tack` with no arguments behaves as: initialize when `.tack/` is missing, otherwise start watch mode. Include tests for both paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No-arg CLI initializes when `.tack/` does not exist
- [ ] #2 No-arg CLI starts watch when `.tack/` exists
<!-- AC:END -->
