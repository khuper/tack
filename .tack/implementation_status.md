# Implementation Status

Binary, source-anchored claims only. If you can't anchor it, mark it as `unknown` or `pending`.

Format:

```text
- log_rotation: implemented (src/lib/logger.ts, src/lib/ndjson.ts)
- compaction_engine: implemented (src/engine/compaction.ts, src/engine/handoff.ts)
- mcp_server: implemented (src/mcp.ts)
- yaml_detectors_framework_auth: implemented (src/detectors/yamlRunner.ts, src/detectors/rules/*.yaml, src/detectors/index.ts)
- detectors_yaml_migration_rest: implemented (src/detectors/index.ts, src/detectors/rules/*.yaml, tests/detectors/*.ts)
- agent_notes_storage: implemented (src/lib/notes.ts, .tack/_notes.ndjson)
- handoff_validation_section: implemented (src/engine/handoff.ts, src/lib/files.ts, src/lib/signals.ts, .tack/verification.md)
- agent_notes_cli: pending
- conversational_mode: pending
```

Start here:
- log_rotation
- compaction_engine
- mcp_server
- yaml_detectors_framework_auth
- agent_notes_storage
