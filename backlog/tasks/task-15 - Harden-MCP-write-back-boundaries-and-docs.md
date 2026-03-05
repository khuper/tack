---
id: TASK-15
title: Harden MCP write-back boundaries and docs
status: In Progress
assignee: []
created_date: '2026-03-03 23:21'
updated_date: '2026-03-03 23:59'
labels:
  - mcp
  - safety
dependencies: []
references:
  - README.md
  - .tack/context.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Align README and MCP tool behavior so write-back channels are explicit and machine-managed files remain protected, including validation of allowed write targets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP tool contracts list allowed write targets
- [ ] #2 Tests cover rejected writes to machine-managed files
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-03-03: README documents MCP resources and write-back channels clearly. Remaining gap: no dedicated automated tests asserting MCP rejects/blocks writes outside allowed channels or to machine-managed files by contract.
<!-- SECTION:NOTES:END -->
