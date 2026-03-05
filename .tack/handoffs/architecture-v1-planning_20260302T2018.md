# TACK Handoff
Project: tack | Session: architecture-v1-planning
Generated: 2026-03-02 (manual — from Claude conversation)

## Summary
Planning session covering MCP server design, skill architecture, v1
ship-blocking fixes, output hardening, agent workflow optimization,
and handoff naming conventions. No code was written. All output is
specs and implementation plans ready for execution.

---

## 1) North Star
- Keep Tack as an offline-first architecture guardrail and deterministic handoff engine. (context.md:4)
- Reduce hallucination risk by enforcing file-grounded state and explicit constraints. (context.md:5)
- Preserve continuity across agents through structured context docs and canonical handoff JSON. (context.md:6)

---

## 2) Decisions Made

### MCP Server
- Transport: stdio (not HTTP/SSE). Both Cursor and Claude Code support it natively. Zero infrastructure. Fits offline-first philosophy. HTTP/SSE can be added later as a second transport without rewriting resource handlers.
- SDK: use @modelcontextprotocol/sdk (official TS SDK). Handles JSON-RPC framing, avoids hand-rolling protocol compliance.
- Entrypoint: src/mcp/index.ts as standalone, wired via `tack mcp start` subcommand.
- Minimum viable surface: read-only resources only. Tools (write-back) deferred to after resources are stable.
- Resources for v1:
  - project://context → reads spec.yaml (goals, guardrails)
  - project://drift → reads _drift.yaml (what's off-track)
  - project://decisions → reads log/decisions (what's been decided)
  - project://health → computed summary from above three
- Resources return text/plain (formatted summary), not raw YAML. Agents don't need to parse structure, they need to understand content.
- Decisions resource capped at ~50 recent entries to manage context window budget.

### Skill Architecture
- Handoff stays in core. It's the product's core value prop, not an optional add-on.
- Core = everything in the current spec (detection, drift, enforcement, status, check-in, log, handoff, MCP resources).
- Skills = opt-in packages for role-specific workflows (prompt-gen, dependency-audit, etc.).
- Skill contract defined: { name, version, commands?, resources?, tools? }
- Discovery: hardcoded known-skills list + try/catch dynamic import. No plugin registry.
- Skills ship as separate npm packages (@tack/skill-*), monorepo with packages/ dir.
- No skills needed for v1 launch. Build when usage demands it.

### Handoff Naming
- Fully automated, zero user friction. No flags or prompts.
- Fallback chain: branch name → latest commit subject (slugified, 40 char cap) → timestamp only.
- Generic branches (main, master, dev, develop) skip to commit subject.
- Format: {slug}_{ISO timestamp}.md/.json
- Example: feat-auth-clerk_20260302T2001.md

---

## 3) Prioritized Work — Three Phases

### Phase 1 — Ship-blockers
All small, targeted fixes. Do these first.

**TTY/raw-mode fallback**
- Add isInteractive() helper in src/lib/tty.ts
- Check process.stdin.isTTY && process.stdout.isTTY && !process.env.CI
- Every Ink command view needs a paired plain-text printer
- `tack watch` can refuse in non-TTY for v1 ("watch requires an interactive terminal")
- Files: new src/lib/tty.ts, modify src/ui/commands/*.tsx

**Publish hygiene**
- Add "files": ["dist/", "README.md", "LICENSE"] to package.json
- Add prepublishOnly script: "bun run build && npm pack --dry-run"
- Optional: add test/publish-hygiene.test.ts that asserts no .tack/, src/, test/, .env in pack output
- Files: package.json

**Git changed-files filter**
- Filter getChangedFiles() output to exclude .tack/ internal paths
- Filter to files only (stat check, treat nonexistent as deleted/kept)
- Handle edge case: renamed files show both old and new paths, old path won't exist on disk — keep it
- Files: wherever getChangedFiles() is defined (likely src/engine/ or src/lib/)

### Phase 2 — Output Hardening
Makes handoff output trustworthy on first read.

**Handoff JSON envelope** — add schema_version, project { name, root, git_ref, git_branch }
**Source reference normalization** — all sources use { file: string, line: number } object form, audit every occurrence
**Actionable next_steps** — replace "Answer question:" echo with conditional logic: check changed_files, drift items, empty guardrails, then open questions last, fallback to "Run tack init"
**Empty section handling** — omit empty sections or show guidance text ("No drift detected — spec is clean")
**Markdown header block** — add project/branch/ref line and 1-2 sentence computed summary at top
**Surface assumptions** — include assumptions.md entries in handoff JSON and markdown as a new section
**Input freshness** — show source file last-modified timestamp per section
**Handoff naming** — implement auto-slug from branch/commit with timestamp suffix

### Phase 3 — Log & Decisions Expansion
Prepares for MCP and project history.

**Expand NDJSON event types** — add drift:detected, drift:resolved, spec:updated, decision, scan, init events. Emit at appropriate points in drift.ts, fs.ts, ui/commands/.
**Actor attribution** — add actor field to log events: "user" for CLI, "agent:{name}" for future MCP tools.
**Formalize decisions.md** — new .tack/decisions.md, human-editable + machine-appendable. Format: "- [YYYY-MM-DD] {decision} — {reasoning}". CLI appends via `tack log decision "..." --reason "..."`. Dual-write: append to decisions.md AND emit decision event to _logs.ndjson.

### Deferred (post-v1)
- MCP tools (write-back)
- HTTP/SSE transport
- Resource subscriptions/notifications
- Non-goal enforcement against detector output
- Guardrail specificity (payments:stripe, db:prisma)
- Skill packages
- Multi-project support

---

## 4) Open Questions (updated)

### Answered This Session
- MCP daemon vs on-demand? → stdio (on-demand, client-spawned). Daemon later if needed.
- Multi-project support? → Single project for v1. `tack switch` can come later.
- Check-in flow file? → Separate file (_checkin.yaml or similar), not drift. Drift is state, check-ins are journal.
- Handoff naming? → Auto-generated from branch/commit, no user input required.

### Still Open
- [open] Should getChangedFiles() fall back from HEAD~1 to staged/working tree when history is shallow?
- [open] Should status plain output include detected systems summary, not only drift health?
- [open] Should init seed spec.yaml with starter guardrails from high-confidence detections only?
- [open] Should scope drift enforcement from Non-Goals be added in v1.x or deferred to v2?

---

## 5) Agent Workflow Notes
- Current dev flow: Opus (planning) → manual translation → Codex (execution)
- Key friction: user is the glue between agents, doing manual handoff reformatting
- Fix: Opus produces Codex-ready task specs with file paths, pseudocode, and expected behavior — no translation step
- Longer-term fix: MCP server running → Claude Code reads context automatically
- Constraint: no Cursor credits, no Claude Code premium seat currently. Codex is the execution layer.

---

## 6) Artifacts Produced This Session
- MCP Server Implementation Plan (file structure, resource definitions, server sketch, client config)
- Tack Skill Contract (TackSkill interface, loadSkills() discovery, example skill package)
- Phase 1 Ship-blockers Implementation (TTY helper, publish hygiene, git filter — with code)
- Output Hardening Punch List (9 items with file paths, pseudocode, agent-ready specs)
- Agent Context Document (full project briefing for cold-start agents)
