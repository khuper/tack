---
id: TASK-26
title: Refine setup-agent command boundaries
status: To Do
assignee: []
created_date: '2026-03-10 12:55'
labels:
  - cli
  - agents
  - refactor
dependencies: []
references:
  - src/index.tsx
  - src/cli/setupAgent.ts
  - src/lib/agentTemplates.ts
  - tests/cli-setup-agent.test.js
  - tests/agentTemplates.test.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The v1 `setup-agent` implementation is correct and intentionally conservative, but review surfaced a cleaner shape for follow-up work if the command grows in v2.

Two areas stand out:

1. `src/cli/setupAgent.ts` currently combines argument parsing, policy decisions, and file writes in one command handler. A cleaner model would split this into a pure planning layer (`create`, `append`, `replace`, `refuse`) and a small apply layer that performs I/O.
2. `src/lib/agentTemplates.ts` currently replaces owned blocks by scanning line markers and rebuilding the string around line ranges. This works, but an offset-based segment model would make newline preservation and future versioned replacement logic simpler and less subtle.

One design insight worth preserving: shared files (`CLAUDE.md`, `AGENTS.md`) and tack-owned files (`.tack/AGENT.md`) have meaningfully different ownership rules. Any future cleanup should preserve that boundary rather than over-generalizing the write path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `setup-agent` command flow is split so decision-making can be tested separately from filesystem writes.
- [ ] #2 Owned-block parsing/replacement is represented in a way that is robust across LF and CRLF files without newline-collapsing edge cases.
- [ ] #3 Shared-file and tack-owned-file policies remain explicit and are not collapsed into a single unsafe overwrite path.
- [ ] #4 Existing install-only behavior and malformed-marker refusal remain covered by tests after the refactor.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
This is not a v1 blocker. It came out of implementation review after shipping `tack setup-agent`.

The current code is acceptable for the shipped scope. Treat this task as cleanup in support of future work such as block versioning, replacement, migration, or broader agent-target support.
<!-- SECTION:NOTES:END -->
