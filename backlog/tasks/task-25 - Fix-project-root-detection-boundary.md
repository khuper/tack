---
id: TASK-25
title: Fix project root detection boundary
status: Done
assignee: []
created_date: '2026-03-09 18:17'
labels:
  - cli
  - dx
  - mcp
dependencies: []
references:
  - src/lib/files.ts
  - src/index.tsx
  - src/plain/init.ts
  - src/plain/status.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tack currently walks upward until it finds any parent `.tack/` directory and then treats that as the active project context. In practice this lets a repo like `C:\Users\cdans\page-agent` incorrectly bind to `C:\Users\cdans\.tack` from the user's home directory even when the repo itself has no `.tack/`.

This breaks first-run behavior and makes MCP tests misleading because `tack init`, `tack status`, `tack watch`, and MCP tools like `get_briefing` all operate against the wrong project memory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tack does not adopt a parent `.tack/` that lives outside the current repo boundary when run inside a separate git repository.
- [x] #2 Running `tack init` inside a repo without its own `.tack/` initializes that repo instead of claiming a parent/home directory is already initialized.
- [x] #3 MCP tools such as `get_briefing` resolve context from the current repo and not from an unrelated parent directory.
- [x] #4 Regression coverage exists for a repo nested under a parent directory that already contains `.tack/`.
<!-- AC:END -->
