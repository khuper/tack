import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type PackageMeta = {
  name: string;
  version: string;
};

let cachedMeta: PackageMeta | null = null;

export function readPackageMeta(): PackageMeta {
  if (cachedMeta) {
    return cachedMeta;
  }

  cachedMeta = findOwnPackageMeta() ?? { name: "tack-cli", version: "0.0.0" };
  return cachedMeta;
}

/**
 * Walks up from this module until it finds Tack's own package.json. The module sits at
 * `dist/lib/` in the tsc build but is inlined into `dist/index.js` by `build:bun`, so a
 * fixed `../../package.json` read the wrong file (or a neighbouring package's) there.
 */
function findOwnPackageMeta(): PackageMeta | null {
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8")) as Partial<PackageMeta>;
      if (parsed.name === "tack-cli" && typeof parsed.version === "string") {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
      // Not here; keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
