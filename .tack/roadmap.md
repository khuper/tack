## Tack Architecture & Product Roadmap

_Agent-facing backlog derived from `context.md`, `open_questions.md`, `decisions.md` (all in `.tack/`)._

---

## 1. Now (post‑v1 polish, before major new surfaces)

These are small, high‑leverage additions that sharpen the core moats (git‑native, deterministic, offline‑first) without changing the architecture.

### NOW‑1: Add validation/verification sections to handoffs ✅ Implemented 2026-03-04

- **What**
  - Extend handoff schema to include a dedicated **Validation / Verification** section.
  - Capture commands/checks the human or external tools should run after applying changes (e.g. tests, linters, health checks), staying inside Tack’s safety boundary (no code execution, only suggestions).
- **Why**
  - Aligns Tack with the PRP idea of **“plan then execute with validation gates”**.
  - Increases trust and usefulness of handoffs as instructions for agents and humans.
- **Grounding in context**
  - `context.md`: PRP discussion and missing validation gates (see “Adjacent Work: Context Engineering / PRPs”).
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — this is part of evolving the core, not an external skill/plugin.
  - **[2026‑03‑02] Skill system deferred for v1 shipping** — favors enriching existing handoff format over new skill mechanisms.
  - **[2026‑03‑03] Tack has two product modes** — validation metadata should be consumable by both power mode and future conversational mode.
- **Resolves / touches open questions**
  - `open_questions.md`: **“What validation/verification section should be added to handoffs…”** → this item is the concrete answer.
  - Partially informs the PRP-style workflow question.

---

### NOW‑2: Extract canonical examples / patterns from the codebase into handoffs

- **What**
  - Build a minimal **pattern extraction** pass that:
    - Identifies canonical implementations for systems like auth, db, payments, jobs, etc.
    - Surfaces 1–3 short, concrete “follow this pattern” snippets per system into handoffs (or referenced notes).
- **Why**
  - PRP analysis notes that **examples dramatically improve AI performance**.
  - Today, detectors know _what_ systems exist but not _how_ they’re implemented.
- **Grounding in context**
  - `context.md`: “The examples folder matters… Tack’s detectors know what systems exist but don’t provide how patterns… future feature could extract canonical code patterns…”
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — patterns should be part of core, deterministic context.
  - **[2026‑03‑03] Framework and auth detectors moved to YAML** — detectors already know “what exists”; this extends their output into patterns.
- **Resolves / touches open questions**
  - `open_questions.md`: **“What is the right way for Tack to surface canonical code patterns (examples)…”** → this item defines the first implementation.
  - Also supports the PRP-style planning question: plans benefit from including canonical patterns.

---

### NOW‑3: Define and ship `tack diff <branch>` / `tack diff main` as an architecture diff

- **What**
  - Implement `tack diff <branch>` (starting with `tack diff main`) that:
    - Shows **decision deltas**, **drift changes**, and **system changes** between current branch and target branch.
    - Outputs a concise, deterministic “architecture diff” handoff/note, not a code diff.
- **Why**
  - Feature branches already carry `.tack/` correctly; this makes architectural changes visible and auditable.
  - Fits into the git‑native, deterministic traceability moat.
- **Grounding in context**
  - `context.md`: Branching strategy section; explicit “Missing piece: `tack diff main`… good v1.1 feature.”
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — architecture diff should be encoded as deterministic state that powers handoffs.
  - **[2026‑03‑03] Bare `tack` defaults to init if `.tack/` missing, otherwise watch** — reinforces “simple default, power features when asked”; `tack diff` lives in the power surface.
- **Resolves / touches open questions**
  - `open_questions.md`: **“What should a `tack diff <branch>` or `tack diff main` command surface…”** → this item specifies the scope: decisions, drift, systems.

---

### NOW‑4: Document PRP‑style framing on top of handoffs (without new UX yet)

- **What**
  - Define and document a **usage pattern** where:
    - LLM layer calls something like `generateHandoff({ intent })`.
    - The handoff is formatted as an **actionable plan** (PRP‑like) plus validation (from NOW‑1) rather than a passive status report.
  - No new commands yet — this is primarily schema and docs for how agents should consume handoffs.
- **Why**
  - Leverages existing engine to approximate PRP workflows without adding user‑facing complexity pre‑conversational mode.
- **Grounding in context**
  - `context.md`: “The PRP concept is worth borrowing… the handoff becomes the PRP.”
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — PRP‑style plans are specific views of the same core state.
  - **[2026‑03‑03] Tack has two product modes** — both modes should benefit from PRP framing later; defining it now keeps the engine ready.
- **Resolves / touches open questions**
  - `open_questions.md`: **“How should Tack expose a PRP-style ‘plan then execute…’ workflow…”** → this is the engine‑level answer (UI/commands deferred to Next).

---

### NOW‑5: Make recent architecture changes explicit in handoffs (“context changelog”)

- **What**
  - Extend handoffs and/or MCP resources to surface **recent architecture changes** explicitly, not just current state. For example:
    - A compact “context changelog” section that highlights the last N decisions and any notable drift items that changed status recently.
    - Clear pointers to “what changed since last time you looked” so agents and humans can quickly orient without re-reading the entire context.
  - Start with data we already have (e.g. `recent_decisions` and drift state) and keep the feature small and deterministic.
- **Why**
  - Sanity-style document history is useful for humans and agents; Tack already has git history for `.tack/` but doesn’t surface **recency slices** in a first-class way.
  - Agents often need to answer “what changed recently?” rather than “what is the full state?” — making this explicit reduces token usage and cognitive load.
- **Grounding in context**
  - `context.md`: “Context that survives compaction” and the emphasis on active-state + history; this item makes the **recent history** piece more discoverable to agents.
  - Handoff already includes `recent_decisions`; this evolves that idea into a more intentional “recent changes” surface.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — a changelog view of architecture changes is part of core deterministic context, not a plugin.
  - **[2026‑03‑03] Tack has two product modes** — both power mode and conversational mode benefit from a clear “what changed recently” slice.
- **Resolves / touches open questions**
  - Clarifies how Tack should present **revision of context** to agents without introducing a central history service — it stays git‑native and file‑based, but with a dedicated surface for “recent changes”.

---

## 2. Next (v1.1–v2 range)

These items introduce new user‑visible capabilities (commands, basic cross‑repo awareness, PRP‑style flows) while staying true to the offline‑first, git‑native engine.

### NEXT‑1: Full `tack diff` UX and integration into handoffs

- **What**
  - Mature `tack diff` into:
    - A first‑class CLI command (`tack diff main`, `tack diff <branch>`).
    - An optional section in handoffs summarizing architecture drift between branch and main.
- **Why**
  - Helps reviewers understand architectural impact of branches alongside code review.
- **Grounding in context**
  - Evolves NOW‑3 into a polished user feature.
- **Supported by decisions**
  - Same as NOW‑3; also builds on **[2026‑03‑03] Bare `tack` defaults to init/watch** by offering a discoverable advanced command.
- **Resolves / touches open questions**
  - Fully resolves the `tack diff` open question by shipping the end‑to‑end UX, not just internal semantics.

---

### NEXT‑2: `tack link` for local multi‑repo linking and basic cross‑repo contradictions

- **What**
  - Add `linked_repos` support in `.tack/spec.yaml` as sketched in `context.md`:
    - Name + relative path entries for peer repos on disk.
  - Extend `tack status` to:
    - Read each linked repo’s `.tack/`.
    - Surface obvious contradictions (e.g. GraphQL vs REST, conflicting product‑level decisions) in a simple, local report.
- **Why**
  - Solves the most common multi‑repo case (multiple repos on one machine) without servers.
  - Strengthens the **git‑native + deterministic traceability + RLL** moats across repo boundaries.
- **Grounding in context**
  - `context.md`: Multi‑repo strategy section; v1.1 `tack link` roadmap item.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — cross‑repo contradictions are context that handoffs can surface.
  - **[2026‑03‑02] MCP transport uses stdio in v1** — keeps everything local; no server yet.
  - **[2026‑03‑03] Tack has two product modes** — both modes should see a unified logical context across linked repos.
- **Resolves / touches open questions**
  - `open_questions.md`: **“How should `tack link` behave… and what cross-repo contradictions should it detect…”** → this item defines: “relative‑path linking + basic contradiction checks” as the default.
  - Partially clarifies “when and how should shared or server context be introduced” by making `tack link` the first step.

---

### NEXT‑3: PRP‑style CLI / LLM UX (`tack plan`, `tack execute`) built on handoffs

- **What**
  - Introduce explicit commands / interfaces:
    - `tack plan "<intent>"` — generates a PRP‑style plan using handoff data + patterns + validation.
    - `tack execute <plan-file>` (or resource equivalent in MCP) — orchestrates step‑wise execution where an agent uses the plan, not Tack itself executing code.
  - Provide MCP resources/operations mirroring these commands for conversational agents.
- **Why**
  - Brings the **Context Engineering / PRP** workflow into Tack as a first‑class pattern.
  - Turns handoffs from static reports into structured execution plans without breaking the safety boundary.
- **Grounding in context**
  - `context.md`: PRP workflow section and the suggested slash‑command pattern.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — PRP plans are views over handoff/core state.
  - **[2026‑03‑03] Tack has two product modes** — `tack plan` lives in power mode; MCP resources expose the same capability in conversational mode later.
  - **[2026‑03‑02] MCP implementation uses @modelcontextprotocol/sdk** — these map naturally to MCP tools/resources.
- **Resolves / touches open questions**
  - `open_questions.md`: PRP-style workflow question is directly addressed with a concrete CLI and MCP interface.
  - `open_questions.md`: Slash-style UX question (`tack plan`, `tack execute`) is answered with specific commands and behavior.

---

### NEXT‑4: First‑class patterns/“examples” surface for agents

- **What**
  - Promote NOW‑2’s pattern extraction into:
    - A dedicated **patterns** section in handoffs.
    - Possibly a `.tack/patterns.md` or resource list consumable via MCP.
- **Why**
  - Makes the “examples folder” concept explicit and standard across projects, while still auto‑generated.
- **Grounding in context**
  - `context.md`: “The examples folder matters… future Tack feature could extract canonical code patterns…”
- **Supported by decisions**
  - Same as NOW‑2; additionally aligns with **[2026‑03‑02] Skill system deferred** by keeping this in core.
- **Resolves / touches open questions**
  - Fully addresses the canonical patterns/examples open question with a user‑visible representation and protocol.

---

### NEXT‑5: Basic cross‑repo shared context (docs‑only `.tack-shared/` guidance)

- **What**
  - Formalize and document the **v1 “docs only”** approach:
    - Recommend teams maintain a `.tack-shared/` (or equivalent) repo/dir for product‑wide decisions and spec.
    - Each individual repo’s `.tack/` reads and surfaces those shared decisions, but there’s no server yet.
- **Why**
  - Provides a stepping stone toward full shared context without infra.
- **Grounding in context**
  - `context.md`: Multi‑repo roadmap layers; v1 docs‑only and v2 `.tack-shared/`.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — shared decisions are still just files read into core.
  - **[2026‑03‑03] Integrity repair runs automatically when spec exists but support files are missing** — ensures `.tack/` stays consistent even when shared files are partially missing.
- **Resolves / touches open questions**
  - `open_questions.md`: Partially resolves the shared `.tack-shared/` vs server timing question by clarifying the **pre‑server** multi‑repo strategy.

---

## 3. Later (v3+ / team‑level and rich UX)

These are larger bets that extend Tack from solo‑dev / single‑machine to team‑wide, multi‑repo, conversational workflows while preserving the core moats.

### LATER‑1: `.tack-shared/` as a first‑class shared context artifact

- **What**
  - Turn `.tack-shared/` (or equivalent) into:
    - A structured directory holding product‑wide `decisions.md`, `spec.yaml`, and `context.md`.
    - A well‑defined import/merge mechanism so per‑repo `.tack/` composes local and shared state.
- **Why**
  - Provides a single source of truth for product‑level decisions across many repos.
  - Deepens the **git‑native + multi‑repo** moat without requiring a server yet.
- **Grounding in context**
  - `context.md`: Multi‑repo roadmap; v2 shared `.tack-shared/` directory.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — shared context is still just files.
  - **[2026‑03‑03] Tack has two product modes** — both modes should read from shared context seamlessly.
- **Resolves / touches open questions**
  - `open_questions.md`: Further answers the “shared `.tack-shared/`” part of the multi‑repo/server question while still keeping things local‑first.

---

### LATER‑2: Team server for aggregated multi‑repo state and MCP access

- **What**
  - Build a **Docker‑based team server** that:
    - Receives `.tack/` pushes from multiple repos.
    - Aggregates cross‑repo context, detects cross‑repo drift, and serves unified context over MCP.
  - Repos remain the **canonical** source of truth; the server is a read/aggregate layer (and optional write-back target for convenience), not a central content lake that replaces git.
  - Likely a paid tier with authentication, history, dashboards.
- **Why**
  - Solves the “three repos all internally ‘correct’ but collectively wrong” failure mode at organizational scale.
  - Strengthens the **write‑back protocol** moat: server context gets richer as agents/humans work.
- **Grounding in context**
  - `context.md`: “v3 (team server)… natural paid tier.”
- **Supported by decisions**
  - **[2026‑03‑02] MCP transport uses stdio in v1** — v3+ can add HTTP/WebSocket while keeping stdio for local mode.
  - **[2026‑03‑02] MCP implementation uses @modelcontextprotocol/sdk** — server becomes just another MCP endpoint.
- **Resolves / touches open questions**
  - `open_questions.md`: Fully answers “when and how should a team server be introduced” — only after strong local‑first story, as an opt‑in layer.

---

### LATER‑3: Rich two‑mode (power + conversational) UX on a single deterministic engine

- **What**
  - Ship the full **two‑mode architecture**:
    - Conversational mode where the user “just talks,” backed by the same deterministic engine as the CLI.
    - Power mode remains for direct `tack` commands and editing `.tack/` files.
  - Provide natural language equivalents for major flows:
    - “What changed in this branch architecturally?” → uses `tack diff`.
    - “Plan Stripe billing” → uses `tack plan`.
    - “Show cross‑repo drift” → uses `tack link` + shared context / server.
- **Why**
  - Realizes the vision: **“one engine, two steering wheels.”**
  - Deepens the **agent‑agnostic via MCP** and **safety boundary** moats by keeping all flows on the same deterministic rails.
- **Grounding in context**
  - `context.md`: Two‑mode architecture and UX section.
- **Supported by decisions**
  - **[2026‑03‑03] Tack has two product modes** — this is the long‑term execution of that decision.
  - **[2026‑03‑02] Handoff remains in Tack core** — conversational UX is just a different way to drive the same core.
- **Resolves / touches open questions**
  - `open_questions.md`: Slash‑style UX question gets fully answered in conversational mode as well as CLI.

---

### LATER‑4: Advanced RLL features and compaction policies (plan‑aware, cross‑repo, long‑lived)

- **What**
  - Evolve RLL and compaction into:
    - Smarter, workload‑aware thresholds (tuned for PRP‑style plans and long‑running projects).
    - Cross‑repo RLL that understands shared context and team server state.
    - Potential “session archetypes” (e.g. large refactor vs feature spike) with different compaction behaviors.
- **Why**
  - Makes Tack’s **RLL architecture moat** deeper and harder to copy.
  - Ensures context remains manageable and token‑efficient across years and many repos.
- **Grounding in context**
  - `context.md`: RLL and compaction as core differentiators.
- **Supported by decisions**
  - All existing decisions that treat handoff/RLL as core rather than ancillary.
- **Resolves / touches open questions**
  - `open_questions.md`: Compaction thresholds open question → this is the long‑term, research‑oriented answer.
  - `open_questions.md`: Resolved assumptions auto‑converting into dated decisions → part of richer compaction semantics.

---

### LATER‑5: Formalizing the write‑back protocol and decision lifecycle

- **What**
  - Define a clear lifecycle for:
    - Assumptions → resolved assumptions → dated decisions (with optional auto‑conversion on compaction).
    - Agent‑written notes → curated decisions.
  - Make this lifecycle visible in UI/CLI and consumable via MCP for agents.
- **Why**
  - Strengthens the **write‑back protocol** and **deterministic traceability** moats.
- **Grounding in context**
  - `context.md`: Write‑back protocol and compaction as key moats.
- **Supported by decisions**
  - **[2026‑03‑02] Handoff remains in Tack core** — decision lifecycle is central to core.
- **Resolves / touches open questions**
  - `open_questions.md`: Directly addresses whether/when resolved assumptions auto‑convert into decisions by defining a policy here.

---

## 4. Cross‑cutting: keep moats front‑and‑center

When prioritizing or designing new work, agents should keep these moats from `context.md` in mind:

- **Git‑native context**: Prefer files in git (`.tack/`, `.tack-shared/`) over databases or opaque services for any new state (patterns, shared context, plans, diffs).
- **Deterministic traceability**: New features (validation, PRP plans, cross‑repo diffs) must keep “every statement traces to source” as a requirement.
- **RLL architecture**: Compaction and token budgeting should remain explicit and tunable, not hidden heuristics.
- **Agent‑agnostic via MCP**: Any new UX (`tack plan`, team server, two‑mode) must expose capabilities via MCP in a way multiple agents can use.
- **Write‑back protocol & safety boundary**: Tack continues to only read/write `.tack/` and never touch user code or shell; agents write back decisions/notes through well‑defined protocols, not arbitrary side‑effects.
- **Offline‑first**: Until the team server tier, everything else must work fully offline; the server is an additive layer, not a replacement.

**Sanity-style guardrails (what we do not adopt):** Tack’s context is “architecture state in the repo”; we learn from schema-first, queryable, productized context for agents, but we explicitly do *not* adopt: **(1) Central lake** — the repo (and optionally `.tack-shared/`) is the source of truth; any team server (LATER‑2) is an optional aggregator view, not a replacement for git-native state. **(2) Content-as-primary-object** — we manage architecture state (spec, drift, decisions, handoffs), not app content (pages, products, CMS); patterns/examples are code snippets about *how* the codebase is built, not content to be served. **(3) Agent-mutates-user-world** — Tack never edits user code or runs shell; agent write-back is limited to `.tack/` (decisions, notes, drift resolution) via well-defined protocols.

