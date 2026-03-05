# Validation / Verification

Describe **how to validate that changes are safe** for this project.

Tack never executes these commands; they are **suggestions** for humans or external tools
to run **after** applying a handoff. Each bullet/numbered item becomes a verification step
in the handoff JSON (`verification.steps`) and in the markdown handoff section 10.

Write real checks as a simple list, for example:

- `bun test` (unit tests)
- `npm run lint` (lint)
- `npx tsc --noEmit` (typecheck)

You can also use numbered lists if you prefer ordering:

1. `bun test`
2. `npm run lint`
3. `npx tsc --noEmit`

