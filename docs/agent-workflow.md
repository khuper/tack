# Agent Workflow

Tack works best when the agent uses a compact read/write loop to stay grounded in accurate project memory instead of stale instructions or broad repo guesses.

## Session Start

Read `tack://session` first.

That resource is the canonical starting point. It gives the current focus, recent decisions, recent notes, memory warnings, and write-back guidance in one compact snapshot.

## Read Deeper Only When Needed

Use this read order:

1. `tack://session`
2. `tack://context/workspace` when you need guardrails, detected systems, unresolved drift, or changed files
3. `tack://context/facts` before changing architecture, dependencies, or constraints
4. `tack://handoff/latest` only when you need full project history or explicit next steps

Optional supporting resources:

- `tack://context/intent` - north star, current focus, goals, non-goals, open questions, recent decisions
- `tack://context/decisions_recent` - recent decisions only
- `tack://context/machine_state` - raw `_audit.yaml` and `_drift.yaml` for debugging or deep inspection

The point is to start compact, then expand only if the task requires it.

## Mid-Task Safety Check

Before structural changes, use `check_rule`.

Examples:

- adding a new dependency
- changing auth or storage
- introducing a new boundary or pattern
- editing architecture-sensitive code

## End-Of-Work Write-Back

Before finishing meaningful work, use `checkpoint_work`.

Use it when you:

- made a decision
- discovered a constraint
- hit a blocker
- left partial work

Use `log_decision` only for a narrow decision without a full checkpoint.
Use `log_agent_note` only for a narrow discovery or warning without a full checkpoint.

## Example: A Fresh Agent Window

Without Tack, a new session often re-reads the repo, re-asks the same questions, or follows stale assumptions.

With Tack:

1. the agent reads `tack://session`
2. sees the current focus, recent decisions, and memory warnings
3. notices stale unfinished work or recurring blockers if they exist
4. reads `tack://context/workspace` only if it needs guardrails or drift details
5. starts work with less prompting and less token waste

## Example: Before Adding A Dependency

The agent wants to add SQLite.

Instead of guessing, it calls `check_rule` with a question like:

```text
Can I use SQLite for local storage here?
```

Tack responds with a compact rule check based on the current spec and context so the agent can proceed or avoid a bad architectural change.

## Example: Ending A Session

The agent changed behavior, hit one blocker, and left a partial refactor.

Instead of scattering notes manually, it calls `checkpoint_work` once with:

- `status`
- a short summary
- optional discoveries
- optional decisions
- related files

That gives the next session something useful to start from.

## If MCP Is Not Available

Read the smallest useful set of files first:

- `.tack/spec.yaml`
- `.tack/context.md`
- `.tack/goals.md`
- `.tack/assumptions.md`
- `.tack/open_questions.md`
- `.tack/implementation_status.md`
- `.tack/decisions.md`
- `.tack/_notes.ndjson`
- `.tack/_audit.yaml`
- `.tack/_drift.yaml`
- `.tack/verification.md`
- `.tack/handoffs/*.md` and `.tack/handoffs/*.json`

Write back:

- append decisions to `.tack/decisions.md` in this format: `- [YYYY-MM-DD] Decision - reason`
- prefer `tack note --message "..." --type discovered --actor agent:name` for notes when MCP is not available

Do not edit these machine-managed files directly:

- `.tack/_audit.yaml`
- `.tack/_drift.yaml`
- `.tack/_logs.ndjson`
