import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { createSignal, type DetectorResult, type Signal } from "../lib/signals.js";
import { readJson, fileExists, grepFiles, listProjectFiles } from "../lib/files.js";
import type { SignalCategory } from "../lib/signals.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export interface YamlSystemRule {
  id: string;
  packages?: string[];
  configFiles?: string[];
  routePatterns?: string[];
  directories?: string[];
}

export interface YamlDetectorRule {
  name: string;
  displayName: string;
  signalId: string;
  category: SignalCategory;
  systems: YamlSystemRule[];
}

function parseRule(content: string): YamlDetectorRule | null {
  const raw = yaml.load(content) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as YamlDetectorRule).systems))
    return null;
  const rule = raw as YamlDetectorRule;
  if (
    typeof rule.name !== "string" ||
    typeof rule.displayName !== "string" ||
    typeof rule.signalId !== "string" ||
    (rule.category !== "system" && rule.category !== "scope" && rule.category !== "risk")
  )
    return null;
  return rule;
}

/** Invalid regex in YAML (e.g. unescaped brackets) skips that pattern instead of throwing. */
function safeRegex(patternStr: string): RegExp | null {
  try {
    return new RegExp(patternStr);
  } catch {
    return null;
  }
}

/**
 * Create a detector that runs from a YAML rule file.
 * Binary detection: if any source matches, emit one signal with confidence 1.
 */
/**
 * Create a detector entry that loads and runs a single YAML rule file.
 * Name/displayName are read once at creation; run() re-reads the file so rules are fresh.
 */
export function createDetectorFromYaml(yamlPath: string): {
  name: string;
  displayName: string;
  run: () => DetectorResult;
} {
  const ruleName = yamlPath.split(/[/\\]/).pop()?.replace(/\.yaml$/, "") ?? "yaml";
  let name = ruleName;
  let displayName = ruleName;
  try {
    const content = readFileSync(yamlPath, "utf-8");
    const rule = parseRule(content);
    if (rule) {
      name = rule.name;
      displayName = rule.displayName;
    }
  } catch {
    // keep defaults
  }

  return {
    name,
    displayName,
    run: (): DetectorResult => {
      try {
        const content = readFileSync(yamlPath, "utf-8");
        const rule = parseRule(content);
        if (!rule) return { name: ruleName, signals: [] };

        const signals: Signal[] = [];
        const pkg = readJson<PkgJson>("package.json");
        const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };

        let projectFiles: string[] = [];
        try {
          projectFiles = listProjectFiles();
        } catch {
          // non-node or no project root
        }

        for (const system of rule.systems) {
          if (!system?.id || typeof system.id !== "string") continue;

          const foundPkgs = (system.packages ?? []).filter((p) => p in allDeps);
          const foundConfigs = (system.configFiles ?? []).filter((f) => fileExists(f));
          const foundDirs = (system.directories ?? []).filter((d) => fileExists(d));

          let routeMatch: string | undefined;
          const routePatterns = system.routePatterns ?? [];
          for (const patternStr of routePatterns) {
            const pattern = safeRegex(patternStr);
            if (!pattern) continue;
            const matches = grepFiles(projectFiles, pattern, 1);
            if (matches.length > 0) {
              routeMatch = matches[0]!.file;
              break;
            }
          }

          const sources: string[] = [];
          if (foundPkgs.length > 0) sources.push(`package.json (${foundPkgs.join(", ")})`);
          if (foundConfigs.length > 0) sources.push(foundConfigs[0]!);
          if (foundDirs.length > 0) sources.push(...foundDirs.slice(0, 3));
          if (routeMatch) sources.push(routeMatch);

          if (sources.length > 0) {
            signals.push(
              createSignal(rule.category, rule.signalId, sources.join(" + "), 1, system.id)
            );
          }
        }

        return { name: rule.name, signals };
      } catch {
        return { name: ruleName, signals: [] };
      }
    },
  };
}

/** Resolve the rules directory for both source (src/detectors/rules) and bundled (dist/detectors/rules). */
export function getRulesDir(): string {
  const baseDir = dirname(fileURLToPath(import.meta.url));
  const nextToMe = join(baseDir, "rules");
  if (existsSync(nextToMe)) return nextToMe;
  return join(baseDir, "detectors", "rules");
}
