# Product Direction

Tack remembers why your project looks the way it does, and keeps that memory honest against the codebase.

## Core Problem

Agent sessions produce reasoning that disappears into chat history:

- why a direction was chosen
- why a simpler path was rejected
- what was tried already
- what the next session should not relitigate

The codebase usually contains the `what`.
The missing piece is the `why`.

## What Tack Is

Tack is a persistent memory layer for coding agents.

Its job is to make the next session start with context that is:

- durable across session boundaries
- grounded in prior decisions and work
- trustworthy enough not to mislead the next agent

This is why Tack has both reasoning capture and detection:

- reasoning capture preserves the `why`
- detection keeps important project memory from going stale

## What Tack Is Not

Tack is not primarily:

- architecture policing
- team coordination software
- a generic agent orchestration layer
- a static rules file with better branding

Those may benefit from Tack, but they are not the wedge.

## Product Priorities

### P0

Make reasoning capture happen by default, without the user having to remember.

- tell agents in the default briefing to self-document decisions and task completion
- capture structured checkpoints at natural task boundaries
- attach git context automatically when decisions or notes are recorded
- leave a lightweight breadcrumb when a session disconnects unexpectedly

### P1

Make session-start context smaller and more useful.

- keep cold-start briefings compact
- surface relevant drift or reasoning early
- load deeper context only when the task needs it

### P2

Reduce maintenance burden.

- remove or consolidate files that do not earn their keep
- prefer captured signals over manual ceremony

## Non-Goals For Now

Do not expand scope until the core reasoning-capture loop works well.

Deferred:

- A2A protocol work
- multi-agent coordination features
- broad template systems
- scoring and analytics layers
- feature routing schemes that depend on richer captured data first

## Design Principles

1. If the user has to remember to do it, it will usually be missed.
2. Agents should preserve context as part of finishing work, not as a separate ceremony.
3. The `why` is the highest-value memory to capture.
4. Verified facts matter when stale context would mislead the next session.
5. Capture rich raw data first; shape product features after real usage patterns emerge.
6. Every feature should make the core sentence above more true, not more complicated.
