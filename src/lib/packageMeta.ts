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

  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.join(moduleDir, "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as Partial<PackageMeta>;
    cachedMeta = {
      name: typeof parsed.name === "string" ? parsed.name : "tack-cli",
      version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    };
  } catch {
    cachedMeta = { name: "tack-cli", version: "0.0.0" };
  }

  return cachedMeta;
}
