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
    const name = readPyprojectName(pyproject);
    if (name) return name;
  }

  return path.basename(root);
}

/**
 * The `name` key of `[project]` (PEP 621), falling back to `[tool.poetry]`. Scoped to
 * those tables because a `name = ...` in an earlier `[[tool.uv.index]]` or
 * `[[tool.poetry.source]]` block is a registry, not the project; and TOML strings can
 * be single-quoted literals as well as basic strings.
 */
export function readPyprojectName(content: string): string | null {
  const names: Record<string, string> = {};
  let table = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?/);
    if (header) {
      table = line.startsWith("[[") ? `[[${header[1]!}` : header[1]!;
      continue;
    }
    if (table !== "project" && table !== "tool.poetry") continue;
    const match = line.match(/^name\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
    const value = (match?.[1] ?? match?.[2] ?? "").trim();
    if (value && !(table in names)) names[table] = value;
  }
  return names["project"] ?? names["tool.poetry"] ?? null;
}
