# Decisions

- [YYYY-MM-DD] Decision title — reason
- [2026-03-06] Standardize CLI features — Added update-notifier, version flags, and picocolors to meet standard developer CLI expectations and improve resilience across platforms.
- [2026-03-06] Treat tack-cli as Tack repo for listProjectFiles skip list — So src/detectors/, tests/, etc. are excluded when package name is "tack-cli", avoiding false drift from rule/test files in the Tack repo.
- [2026-03-06] Exclude rule file directory from YAML detector grep — When running a detector from a rule file, never search inside that rule’s directory; prevents matching rule definitions as project code for any project with in-tree rule YAML.
