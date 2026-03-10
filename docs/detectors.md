# Detectors And YAML Rules

Detection is YAML-driven.

Bundled rules live in `src/detectors/rules/*.yaml` and ship with the CLI. At runtime, Tack also loads `*.yaml` from `.tack/detectors/` so projects can add or override detectors.

Rule files use:

- top-level `name`, `displayName`, `signalId`, and `category`
- a `systems` list with `id`, `packages`, `configFiles`, optional `directories`, and optional `routePatterns`

If any configured package, config file, directory, or route pattern matches, Tack emits a signal for that system.

This lets Tack stay data-driven for most architecture detection instead of hardcoding every framework, database, auth system, or background job tool in TypeScript.
