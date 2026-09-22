# Detectors And YAML Rules

Detection is YAML-driven.

Bundled rules live in `src/detectors/rules/*.yaml` and ship with the CLI. At runtime, Tack also loads `*.yaml` from `.tack/detectors/` so projects can add or override detectors.

Rule files use:

- top-level `name`, `displayName`, `signalId`, and `category`
- a `systems` list with `id`, `packages`, `configFiles`, optional `directories`, and optional `routePatterns`

If any configured package, config file, or directory matches, Tack emits a signal for that system. Route patterns (identifiers grepped from source files, such as `useUser`) add a source location to a system that a package, config file, or directory already proves; they only detect a system on their own when the rule declares none of those channels. Several providers share identifiers, and a README can mention a library the project does not use, so an identifier alone is not evidence.

This lets Tack stay data-driven for most architecture detection instead of hardcoding every framework, database, auth system, or background job tool in TypeScript.
