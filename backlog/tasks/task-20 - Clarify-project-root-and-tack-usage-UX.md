---
id: TASK-20
title: Clarify project root and Tack usage UX
status: Done
assignee: []
created_date: '2026-03-05 15:36'
labels:
  - cli
  - dx
dependencies: []
references:
  - src/lib/files.ts
  - src/index.tsx
  - README.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the developer experience when running `tack` from the "wrong" directory by making project root detection and `.tack` expectations clearer, surfacing helpful error or guidance messages instead of surprising legacy migration behavior, and documenting recommended usage patterns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Running `tack` commands from a directory that does not contain (or inherit) a `.tack/` folder produces a clear, actionable message indicating that Tack should be run from a project root with `.tack/` rather than attempting to silently migrate or operate on sibling directories.
- [x] #2 `projectRoot()` / legacy migration logic in `src/lib/files.ts` is hardened so it cannot accidentally try to rename a non-context `tack` directory that is actually a separate project, and this behavior is covered by tests.
- [x] #3 CLI help text and/or `README.md` include a short section explaining how Tack determines the project root, where `.tack/` is expected to live, and how to avoid common pitfalls when invoking `tack` from shells or global aliases.
<!-- AC:END -->
