# Context

## North Star
- Keep Tack as an offline-first architecture guardrail and deterministic handoff engine.
- Reduce hallucination risk by enforcing file-grounded state and explicit constraints.
- Preserve continuity across agents through structured context docs and canonical handoff JSON.
- Keep power mode and conversational mode on the same deterministic core functions.

## Current Focus
- Stabilize power mode (`init`, `status`, `watch`, `handoff`, `log`) with reliable plain/Ink behavior.
- Keep `tack` default behavior intuitive: init if missing `.tack/`, otherwise start watch.
- Prepare MCP resources as function interfaces for future conversational mode.
- Keep RLL layering explicit in context files: core schema, semantic differential, and cross-agent handshake.

## Notes
- LLM is planned as an interface layer (intent capture), not an enforcement engine.
- Conversational mode must call the same deterministic functions as power mode.
- Handoff content remains deterministic and source-traceable; no direct LLM-written handoff output.
  - Handoffs should surface not just the current architecture state, but also **recent changes** (e.g. last N decisions, notable drift status changes) in a compact, deterministic way so agents can answer “what changed recently?” without re-reading the entire context.

## Product Moats

**Git-native context.** Everyone else stores context in a database, a cloud service, or a chat history. Tack stores it in the repo. Clone the repo, get the context. No account, no sync, no server. This is architecturally simple but nobody else does it because they all want to be SaaS. You can't easily replicate "context that branches and merges like code" with a database.

**Deterministic traceability.** Every statement in a Tack handoff traces to a source file and line number. No other tool does this. Cursor's context is a mystery. Copilot's context is a mystery. Claude Code's CLAUDE.md is freeform text with no verification. Tack's output is auditable. For regulated industries, enterprise, and anyone who needs to trust their agent's context, this matters enormously.

**The RLL architecture.** Active state only, domain-scoped, token-budgeted. This isn't just a feature — it's a fundamentally different approach to agent context management. Everyone else is doing "dump everything into the context window" or "summarize and hope." You're doing structured state with compaction, scoping, and selective loading. This is defensible because it's an architecture, not a feature.

**Agent-agnostic via MCP.** Tack works with Cursor, Claude Code, Codex, Windsurf, and anything that supports MCP. You're not locked to one agent ecosystem. Every competitor is building context for *their* agent. You're building context for *all* agents. When someone switches from Cursor to Claude Code, their Tack context comes with them. That's switching-cost moat in reverse — Tack reduces switching costs for the user while increasing them for Tack itself.

**Write-back protocol.** Agents don't just read from Tack, they write back to it. Decisions, notes, drift resolution. The context gets richer with every agent session automatically. This creates a flywheel — the more you use agents, the more valuable Tack's context becomes, the more you need Tack. No other context tool has a two-way protocol with agents.

**The safety boundary.** Tack never edits your code. Never runs shell commands. Never writes outside `.tack/`. In a market where every agent wants root access and auto-approve mode, Tack is the observable agent that can't break anything. This isn't just a feature — it's trust. And trust is the hardest moat to replicate because it takes time to earn.

**Offline-first.** No network dependency for core functionality. Works on a plane, works in a classified environment, works when the API is down. Every cloud-dependent tool has a single point of failure. Tack doesn't.

**Context that survives compaction.** Most tools either keep everything (expensive) or summarize (lossy). Tack's compaction moves resolved items to an archive while keeping active state lean. Nothing is lost, but the working set stays small. This is the "context scales with complexity, not time" principle from your RLL, and it's the reason a two-year-old project costs the same tokens as a two-week-old project.

The deepest moat is the combination of the first three: git-native, deterministic, and structured. Anyone can build "context for agents." Building context that's version-controlled, auditable, branch-aware, token-budgeted, and agent-agnostic all at once requires the architectural choices you've already made. Those choices are hard to bolt on after the fact.

## Adjacent Work: Context Engineering / PRPs

He's built a template system around "Context Engineering" — providing AI coding assistants with comprehensive context through structured files: CLAUDE.md for global rules, INITIAL.md for feature requests, and PRPs (Product Requirements Prompts) as detailed implementation blueprints.

The methodology works in three phases: requirements definition in INITIAL.md files, implementation planning through PRP workflows, and checkpoint validation where each step must pass before proceeding.

The PRP workflow is: user writes a feature request → /generate-prp command researches the codebase, gathers documentation, and creates a comprehensive implementation plan → /execute-prp command reads the plan and implements it step by step with validation gates.

### What this validates about Tack

His entire thesis is that context is the bottleneck — "most agent failures aren't model failures, they're context failures." That's exactly Tack's positioning. He's proving the market exists.

His CLAUDE.md is a manual, freeform version of what Tack's `.tack/` directory does structurally. His examples folder is manual context that Tack's detectors and onboarding automate. His PRPs are manual versions of what Tack's handoffs generate automatically.

### What Tack does that this doesn't

His approach is entirely manual. Someone has to write CLAUDE.md, curate the examples folder, write INITIAL.md, and maintain all of it by hand. Nothing detects drift. Nothing enforces guardrails. Nothing auto-generates from the codebase. When the project changes, the context docs go stale unless a human updates them.

Tack automates this whole pipeline. Detection builds the context. Guardrails enforce it. Drift tracking keeps it current. Handoffs generate from real state. The LLM onboarding asks the right questions. Nobody has to manually curate an examples folder or write implementation blueprints from scratch.

### What we should learn from him

The PRP concept is worth borrowing. His "generate a detailed implementation plan, then execute it with validation" two-step workflow is smart. Tack's handoffs are the context half of this, but Tack doesn't have the plan half. When someone says "build stripe recurring billing," Tack could generate a PRP-like plan that includes the relevant context from `.tack/`, the guardrails to follow, and the validation steps to run — then hand that to an agent.

This isn't a new feature to build so much as a usage pattern: when the LLM layer calls something like `generateHandoff({ intent: "stripe recurring billing" })` and formats the output as an actionable plan rather than just a status report, the handoff becomes the PRP.

The examples folder matters. He emphasizes that AI performs dramatically better with code examples to follow. Tack's detectors know what systems exist but don't provide how patterns. A future Tack feature could extract canonical code patterns from the codebase and include them in context — "here's how auth is implemented in this project, follow this pattern."

Validation gates are the missing piece. His PRPs include test commands that must pass at each step. Tack's handoffs don't include verification steps. Adding a validation section to handoffs — "after implementing, run these commands to verify compliance" — would make them significantly more useful as agent instructions.

The slash commands are a UX pattern to adopt. `/generate-prp` and `/execute-prp` are simple, memorable, and self-documenting. When Tack's LLM mode ships, having similar patterns — `tack plan "stripe billing"` and `tack execute plan.md` — would be natural.

## Branching, Monorepo, and Multi-Repo Strategy

### Feature branches (works today)

Tack is scoped to one directory with one `.tack/` folder. For a single-repo project, this works great. For feature branches, it actually already does the right thing:

- When someone creates a feature branch, `.tack/` comes with it.
- They make decisions on their branch, drift is tracked on their branch, handoffs are generated from their branch's state.
- When they merge back to main, the `.tack/` files merge too. Conflicting architecture decisions surface as git conflicts in `decisions.md` or `spec.yaml`, which is where those conflicts belong.
- Handoff naming and git metadata already capture the branch.

This should be marketed explicitly: `.tack/` is just files in git, so you get branching context for free.

Missing piece: a `tack diff main` (or similar) command that shows an **architecture diff** between your branch and main — decisions made, drift introduced, systems added — not just code diff. This is a good v1.1 feature.

### Multi-repo (real gap)

Today, multi-repo products (frontend, backend, shared libs, infra) each have their own `.tack/`. Each is internally consistent but there is no unified product view. Example failure mode:

- Backend decides to switch from REST to GraphQL.
- Frontend keeps building REST clients.
- Infra provisions resources for a REST API.
- Three repos, three `.tack/` directories, all internally "correct" and collectively wrong.

Roadmap layers:

- **v1 (docs only):** Recommend teams put cross-repo decisions into every repo's `decisions.md` manually. Low-tech and discipline-based, but workable for small teams.

- **v1.1 (small feature):** `tack link` in `.tack/spec.yaml` to reference sibling repos on disk:

  ```yaml
  linked_repos:
    - name: frontend
      path: ../frontend
    - name: backend
      path: ../backend
  ```

  `tack status` can then read linked repos and flag contradictions (e.g. backend spec says GraphQL while frontend spec still says REST). Still local, still offline; just follows relative paths.

- **v2 (shared context):** Introduce a shared `.tack-shared/` directory (e.g. git submodule) that holds cross-cutting product context:

  - `decisions.md` for product-wide decisions.
  - `spec.yaml` for product-wide guardrails.
  - `context.md` for product-level north star.

  Each repo keeps its own `.tack/` plus imports/reads from `.tack-shared/`.

- **v3 (team server):** Docker-based team server where each repo pushes its `.tack/` state. The server aggregates cross-repo context, detects drift across repos, and serves unified context via MCP. This is a natural paid tier.

For a 40k LOC monorepo, Tack already works fine: one repo, one `.tack/`, one set of guardrails; the main risk is performance (detectors and git diff), which is handled by better progress feedback and sensible timeouts.

Guidance: **do not** build full multi-repo support before publish. A small `tack link` feature with relative paths is a high-value v1.1 step that solves the most common multi-repo case on a single machine.

## Two-Mode Architecture and UX

The ideal UX: the user runs `tack init`, talks to it naturally, and Tack handles everything — context, guardrails, handoffs, notes. They never open `spec.yaml`. They never type `tack handoff --for "stripe billing"`. They just say what they're working on and Tack does the right thing behind the scenes.

Power users who want to hand-edit YAML files and run specific CLI commands can do that. But they don't have to. And the output is identical either way because both paths hit the same engine.

This is why the two-mode architecture matters so much. We're not building two products. We're building one engine with two steering wheels — natural language for everyone, CLI for power users. The person who doesn't know what a YAML file is and the person who lives in the terminal both get the same traceable, deterministic, git-versioned context.

Landing page rewrite in one line: **"Your agent already knows how to use Tack. You don't have to."**

## Standard Subagent Task Template

When defining tasks for LLM subagents, always start with an explicit permissions and completion header. This keeps read/write boundaries obvious and turns the handoff into the acceptance criteria.

```markdown
## Permissions
READ:  src/engine/handoff.ts, src/lib/notes.ts, .tack/_notes.ndjson
WRITE: src/engine/handoff.ts, src/plain/handoff.ts, tests/engine/handoff.test.ts
NEVER: src/index.tsx, .tack/spec.yaml, anything outside src/ and tests/
OUTPUT: Updated handoff with agent notes section, passing tests
LOGGING: If you change any external behavior (schema or markdown contract, CLI behavior, etc.), add 1 decision to .tack/decisions.md and 1 entry to .tack/_notes.ndjson summarizing the work and files touched.
```

Pattern: when a subagent is called from a Tack handoff, its job is done when the handoff's **Next Steps** relevant to that task are resolved. The Next Steps section is the acceptance criteria; the task body should point back to it instead of restating everything.
