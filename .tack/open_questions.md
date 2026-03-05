# Open Questions

- [resolved] MCP daemon vs on-demand? Use stdio on-demand (client-spawned) for v1.
- [resolved] Multi-project support? Single project for v1; defer `tack switch`.
- [resolved] Check-in flow file? Keep separate from drift state.
- [resolved] Handoff naming? Auto-generate from branch/commit plus timestamp.
- [open] Should `tack check-in` ship in v1 or stay deferred behind MCP resources?
- [open] Where should domain tags be defined in spec schema without breaking v1 compatibility?
- [open] What exact compaction thresholds should trigger before handoff generation?
- [open] Should resolved assumptions auto-convert into dated decisions during compaction?
- [open] How should Tack expose a PRP-style "plan then execute with validation gates" workflow on top of handoffs?
- [open] What is the right way for Tack to surface canonical code patterns (examples) from the codebase for systems like auth, db, and payments?
- [resolved] What validation/verification section should be added to handoffs? Dedicated section 10 in handoff + `.tack/verification.md` (bullets/numbered list); suggestions only, no execution (NOW-1 implemented 2026-03-04).
- [open] What slash-style or CLI UX (`tack plan`, `tack execute`) should Tack adopt for its future LLM mode?
- [open] What should a `tack diff <branch>` or `tack diff main` command surface as an \"architecture diff\" (decisions, drift, systems) between branches?
- [open] How should `tack link` behave for linked repos on disk, and what cross-repo contradictions should it detect by default?
- [open] When and how should a shared `.tack-shared/` or team server be introduced without breaking Tack's offline-first, local-first guarantees?
- [deferred] How should LLM onboarding work (ensure .tack/, fresh status, MCP/handoff as primary interface) so the LLM is in the right state for Tack on day one? Defer until we add conversational/agent support.
