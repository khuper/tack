# Code Review Handoff — Validation Gates in Handoffs + .tack Versioning

**Scope:** Handoff verification section behavior, tests, docs, and un-ignoring `.tack/`.  
**Commits (relevant):** `tack: refine verification section in handoff`, `tack: start versioning .tack dir`  
**No engine logic changes** in `src/engine/handoff.ts` for this scope; existing `parseVerificationSteps` and section 10 rendering were already in place and were documented/tested.

---

## 1) What Was Done

- **Tests** (`tests/engine/handoff.test.ts`): Added three tests for the handoff verification flow:
  - **Propagation:** Bullet and numbered lines in `.tack/verification.md` appear in `report.verification.steps` and in markdown section 10.
  - **Empty/placeholder:** File with only headers or prose (no list items) yields empty `steps` and the placeholder message in markdown.
  - **Sanitization:** Verification steps are sanitized only when rendering markdown (`sanitizeMd`); JSON keeps raw step text (e.g. characters like `<`, `` ` ``, `[`, `]` preserved in `verification.steps`).
- **Docs:**  
  - **README.md:** Documented `verification.md` in “What It Does”, in “Direct File Access → Read”, and under the `handoff` command (Validation / Verification section, non-execution note).  
  - **.tack/verification.md:** Turned into a clear template (purpose, bullet vs numbered, examples). The examples in the template are real list items, so they will be parsed as steps when that file is used as-is.
- **.gitignore:** Removed `.tack/` so that `.tack/` contents (e.g. `decisions.md`, `verification.md`, `spec.yaml`) can be versioned.
- **Decisions:** Logged in `.tack/decisions.md`: (1) tighten verification handoff behavior (parser/source/sanitize-at-render), (2) start versioning `.tack` contents.

---

## 2) Files to Review

| File | Change |
|------|--------|
| `tests/engine/handoff.test.ts` | New tests: propagation, empty/placeholder, sanitization. |
| `README.md` | Mentions of `verification.md` and handoff Validation / Verification section. |
| `.gitignore` | Removed `.tack/` line. |
| `.tack/verification.md` | Template text and example steps (project-specific; only in this repo’s `.tack`). |
| `.tack/decisions.md` | New decision entries (and possibly existing ones if you’re doing a broader pass). |

**Not modified in this scope:** `src/engine/handoff.ts`, `src/lib/signals.js`, or any detector/MCP code.

---

## 3) Review Focus

- **Tests:**  
  - Confirm the three new tests match the intended behavior (bullets `-`/`*`, numbered `1.`/`2)`; empty steps; JSON raw, markdown sanitized).  
  - Check that tests don’t rely on environment-specific paths or side effects outside the temp dir.
- **Parsing contract:**  
  - `parseVerificationSteps` (in `handoff.ts`) treats a line as a step only if it matches bullet or numbered patterns; blank lines and prose are ignored. No change was made to this logic; review only if you want to tighten or extend the contract.
- **.tack versioning:**  
  - With `.tack/` no longer ignored, machine-managed files (e.g. `_audit.yaml`, `_drift.yaml`, `_logs.ndjson`) can be committed if present. Docs say “do not modify”; consider whether you want a short note in README or CONTRIBUTING that these may be committed for the tack repo itself but are still machine-owned.
- **Docs:**  
  - README and `.tack/verification.md` should read consistently with “Tack does not execute these; they are suggestions for humans or external tools.”

---

## 4) How to Verify

1. **Typecheck:**  
   `npm run typecheck` (or `bun run typecheck` if using Bun).
2. **Tests:**  
   `npm test` or `bun test` (handoff tests in `tests/engine/handoff.test.ts`).
3. **Handoff output:**  
   - Run `tack handoff` (or `node dist/index.js handoff`).  
   - Open the latest `.tack/handoffs/*.json` and confirm `verification.steps` and `verification.source.file === ".tack/verification.md"`.  
   - Open the latest `.tack/handoffs/*.md` and confirm section `## 10) Validation / Verification` and either a bullet list of steps or the placeholder when there are no steps.
4. **.tack tracked:**  
   `git status` should show `.tack/` files as trackable (e.g. `decisions.md`, `verification.md`) when modified.

---

## 5) Decisions (for context)

- Verification steps: parsed from `.tack/verification.md` (bullets/numbered only); JSON keeps raw text; markdown render sanitizes for display.  
- `.tack/` is now versioned so spec, context, decisions, and verification docs can be tracked; machine-managed files remain “do not modify” by convention.

---

## 6) Out of Scope / Not Done

- No automatic execution of verification commands.  
- No changes to `_audit.yaml` / `_drift.yaml` or detector behavior.  
- No handoff schema version bump or changes to other handoff sections.  
- No change to how `verificationPath()` or `readFile(verificationPath())` is called in `handoff.ts`.

---

*Generated for code review. After review, this file can be kept for history or removed.*
