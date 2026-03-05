---
id: TASK-17
title: Make build pipeline node-native and cross-platform
status: To Do
assignee: []
created_date: '2026-03-05 15:30'
labels: []
dependencies: []
references:
  - README.md
  - package.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the Bun-only build pipeline with a Node/TypeScript-based build so `npm run build` works out of the box on Windows, macOS, and Linux while still supporting Bun as an optional fast path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `npm run build` succeeds on a clean Node environment without Bun installed, compiling TypeScript to `dist/` and copying required runtime assets (e.g. `yoga.wasm`, YAML detector rules).
- [ ] #2 `README.md` documents a Node/TypeScript build path (install + build + global/local CLI usage) and, if retained, clearly frames Bun as optional.
- [ ] #3 Existing commands that depend on `dist/index.js` (e.g. `tack` via `npm link` or direct `node dist/index.js`) work on Windows and POSIX shells.
<!-- AC:END -->

