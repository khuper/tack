# Goals

## Goals
- Enforce declared architecture contracts from `/.tack/spec.yaml` via deterministic scans.
- Persist architecture drift and risk state in machine files under `/.tack/`.
- Generate agent handoffs from structured inputs only: context docs, audit, drift, and git file changes.
- Keep CLI usable in interactive and non-interactive environments with clear fallback behavior.
- Keep power mode stable and make every command callable as a deterministic function.
- Add conversational mode as an LLM interface to existing Tack functions (not a separate engine).
- Ship MCP read-only resources for context continuity with domain-scoped retrieval.
- Keep active-state files lean via compaction before handoff and check-in flows.

## Non-Goals
- No LLM-generated enforcement decisions or drift assessments.
- No network-dependent product features.
- No SaaS backend, account system, or hosted control plane.
- No conversational shortcut that bypasses deterministic engine functions.
- No broad refactors that destabilize v1 command behavior.
