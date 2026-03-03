import * as path from "node:path";
import { projectRoot, readFile, readJson } from "./files.js";

type PkgJson = {
  name?: string;
};

export function getProjectName(): string {
  const root = projectRoot();

  const pkg = readJson<PkgJson>("package.json");
  if (pkg?.name && pkg.name.trim()) {
    return pkg.name.trim();
  }

  const pyproject = readFile("pyproject.toml");
  if (pyproject) {
    const nameMatch = pyproject.match(/^name\s*=\s*"([^"]+)"/m);
    if (nameMatch?.[1]?.trim()) {
      return nameMatch[1].trim();
    }
  }

  return path.basename(root);
}
