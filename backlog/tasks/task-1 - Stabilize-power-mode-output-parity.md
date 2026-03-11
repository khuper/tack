---
id: TASK-1
title: Stabilize trust parity across plain and Ink surfaces
status: To Do
assignee: []
created_date: '2026-03-03 23:19'
labels: []
dependencies: []
references:
  - src/ui/Watch.tsx
  - src/plain/watch.ts
  - src/plain/status.ts
  - src/plain/handoff.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Keep the trust-critical surfaces aligned across plain and Ink output, especially for first-run verification and session visibility.

Manual CLI usage still matters, but it is now secondary to the MCP-first flow (`tack setup-agent`, `tack watch`, `TACK_AGENT_NAME=... tack mcp`, `checkpoint_work`). This task should only cover parity for the signals users rely on to trust that flow, not pixel-identical rendering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `watch` shows the same core install-verification and session-state milestones in plain and Ink modes, allowing timing and layout differences.
- [ ] #2 `status` and `handoff` expose the same core project state and next-step guidance in plain and Ink modes, allowing presentation differences.
- [ ] #3 `init` ends in the same practical first-run guidance across plain and Ink modes, even if the interactive flow differs.
- [ ] #4 Secondary commands such as `log` and `note` are explicitly out of scope unless their output directly affects first-run trust or MCP workflow understanding.
<!-- AC:END -->
