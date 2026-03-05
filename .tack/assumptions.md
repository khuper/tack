# Assumptions

- [open] Users run Tack from the target project root so `/.tack/` aligns to intended scope.
- [open] Detectors remain deterministic and file-system based (no external APIs).
- [open] Handoff consumers prioritize JSON output as canonical over markdown formatting.
- [open] Conversational mode will call existing deterministic functions instead of writing direct engine outputs.
- [open] LLM usage remains optional; core flows work without API keys.
- [open] Watch mode occupies one terminal and users run one-shot commands in a second terminal.
