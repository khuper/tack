---
id: TASK-30
title: Integrate pending handoff awareness into session start
status: To Do
assignee: []
created_date: '2026-03-11 16:06'
labels:
  - handoff
  - mcp
  - ux
dependencies:
  - TASK-28
  - TASK-29
references:
  - src/engine/memory.ts
  - src/mcp.ts
  - src/lib/mcpCatalog.ts
  - docs/mcp-clients.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make pending or active handoffs visible during session startup so agents start with the right context without relying on users to remember another command.

The main path should be startup-aware briefing behavior: if a handoff has been picked up, `get_briefing` and related startup context should include the active handoff summary. If an eligible pending handoff exists but has not yet been claimed, Tack may surface a lightweight hint in startup or guardrail responses, but should not hide lifecycle mutation inside unrelated tools like `check_rule`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Session-start context (`get_briefing`, `tack://session`, or equivalent startup surfaces) includes active picked-up handoff context when one exists.
- [ ] #2 When a relevant pending handoff exists but is not yet picked up, Tack can surface a lightweight hint that guides the agent toward the explicit resume/pickup path.
- [ ] #3 `get_briefing` does not become the primary mutation path for claiming handoffs; pickup remains an explicit lifecycle action.
- [ ] #4 Any `check_rule` handoff hinting remains additive and does not overload the guardrail tool with hidden state transitions.
<!-- AC:END -->
