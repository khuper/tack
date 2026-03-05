## Tack Plugin Ideas (Speculative / Optional)

_Non-core integrations and workflows that build on Tack’s architecture, but are **not** part of the main roadmap. These are ideas some teams may want, not required for v1 or the core engine._

---

### Skills model (framing for later)

- **Positioning:** Tack is at its best when used **with your other tools** (backlogs, CI, issue trackers, etc.). We don’t replace them; we integrate.
- **Integration layer = agent skills**, similar to Anthropic’s model:
  - **Official skills** — We ship skills that connect Tack to specific tools (e.g. update `backlog.md` from handoff next steps, sync decisions to Linear). Reduces friction; one skill per tool or workflow.
  - **User-defined skills** — Users can build their own skills so Tack fits their stack. We document the contract; they own the integration.
- **Use this framing in README and docs** when we add skills: “Tack ships with official skills that integrate with tools like X; you can build your own skills too.” Only name specific official skills once they exist.
- **Not limited to roadmap/backlog** — Skills can integrate with CI, ticketing, dashboards, or any tool we (or users) add.

---

### PLUGIN-1: `@tack/plugin-review` (Code Review / CI Integration)

- **What**
  - A CI / PR-bot style integration that:
    - Reads Tack’s context (e.g. `.tack/spec.yaml`, `.tack/decisions.md`, `.tack/_drift.yaml`, handoff JSON).
    - Runs a code review agent against a specific PR or branch diff.
    - Emits **structured review findings** (e.g. JSON array of `{ severity, file, lines, title, what, why, suggestion }`) that the CI system turns into inline comments.
- **Why**
  - Keeps Tack focused on **architecture state and guardrails**, while allowing teams to plug that state into code review workflows.
  - Avoids overloading Tack’s core handoff schema with review-specific concerns (“what’s wrong with this diff”) that belong to CI / review tooling.
- **Tack’s Role**
  - **Input, not output**:
    - Provide guardrails and project state for the review agent.
    - Surface architectural implications of review findings (e.g. “PR introduces a forbidden system”) as notes or drift, via `tack note` or MCP.
  - The **review findings schema** and comment formatting live in the plugin / CI integration, not in core Tack.
- **Status**
  - Idea only; good candidate for a community plugin or first-party add-on once v1 core is stable.

---

_Guideline: Plugins live at the boundary where Tack’s deterministic context is an input to other systems (CI, ticketing, dashboards, etc.). Core Tack owns architecture state, drift, and handoffs; plugins own how that state is consumed in specific workflows._

