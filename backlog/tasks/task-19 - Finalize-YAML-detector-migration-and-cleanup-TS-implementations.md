---
id: TASK-19
title: Finalize YAML detector migration and clean up TS implementations
status: To Do
assignee: []
created_date: '2026-03-05 15:34'
labels:
  - detectors
dependencies: []
references:
  - src/detectors/index.ts
  - src/detectors/yamlRunner.ts
  - src/detectors/rules/*.yaml
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the migration to YAML-based detectors by removing legacy TypeScript detector implementations that have been superseded by rules in `src/detectors/rules/*.yaml`, updating tests to exercise the YAML path (`runAllDetectors` / `yamlRunner`) and clarifying that YAML is the source of truth for user-extensible detectors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Legacy TS detector files for systems now backed by YAML (framework, auth, db, payments, background_jobs, exports) are no longer imported or required at runtime, and detector wiring in `src/detectors/index.ts` relies on `createDetectorFromYaml` for these systems.
- [ ] #2 Detector tests have been updated to assert behavior through the YAML path (e.g. `runAllDetectors`, `yamlRunner`) instead of importing legacy `detect*` TS functions directly.
- [ ] #3 Developer-facing docs (README or a short detectors section) explicitly state that new detectors should be added as YAML rules and outline the supported schema fields.
<!-- AC:END -->

