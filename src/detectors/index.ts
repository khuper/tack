import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Signal, DetectorResult } from "../lib/signals.js";
import { createDetectorFromYaml, getRulesDir } from "./yamlRunner.js";
import { detectMultiuser } from "./multiuser.js";
import { detectAdmin } from "./admin.js";
import { detectDuplicates } from "./duplicates.js";

export type DetectorEntry = {
  name: string;
  displayName: string;
  run: () => DetectorResult;
};

const rulesDir = getRulesDir();

function listYamlFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".yaml"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function loadYamlDetectors(): DetectorEntry[] {
  const detectors: DetectorEntry[] = [];
  const seen = new Set<string>();

  const coreRuleNames = ["framework", "auth", "database", "payments", "jobs", "exports"];

  for (const base of coreRuleNames) {
    const rulePath = join(rulesDir, `${base}.yaml`);
    if (!existsSync(rulePath)) continue;
    const key = rulePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    detectors.push(createDetectorFromYaml(rulePath));
  }

  for (const file of listYamlFiles(rulesDir)) {
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    detectors.push(createDetectorFromYaml(file));
  }

  const tackDetectorsDir = join(process.cwd(), ".tack", "detectors");
  for (const file of listYamlFiles(tackDetectorsDir)) {
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    detectors.push(createDetectorFromYaml(file));
  }

  return detectors;
}

const YAML_DETECTORS: DetectorEntry[] = loadYamlDetectors();

export const PRIMARY_DETECTORS: DetectorEntry[] = [
  ...YAML_DETECTORS,
  { name: "multiuser", displayName: "Scanning for multi-tenant patterns", run: detectMultiuser },
  { name: "admin", displayName: "Scanning for admin routes", run: detectAdmin },
];

export function runAllDetectors(): { results: DetectorResult[]; signals: Signal[] } {
  const results: DetectorResult[] = [];
  const allSignals: Signal[] = [];

  for (const detector of PRIMARY_DETECTORS) {
    const result = detector.run();
    results.push(result);
    allSignals.push(...result.signals);
  }

  const dupeResult = detectDuplicates(allSignals);
  results.push(dupeResult);
  allSignals.push(...dupeResult.signals);

  const seen = new Map<string, Signal>();
  for (const sig of allSignals) {
    const key = `${sig.category}:${sig.id}:${sig.detail ?? ""}`;
    const existing = seen.get(key);
    if (!existing || sig.confidence > existing.confidence) {
      seen.set(key, sig);
    }
  }

  return {
    results,
    signals: Array.from(seen.values()),
  };
}

export function detectorsForFileChange(filepath: string): DetectorEntry[] {
  const f = filepath.toLowerCase();

  if (
    f === "package.json" ||
    f.endsWith("package-lock.json") ||
    f.endsWith("bun.lockb") ||
    f.endsWith("yarn.lock") ||
    f.endsWith("pnpm-lock.yaml")
  ) {
    return PRIMARY_DETECTORS;
  }

  const triggered: DetectorEntry[] = [];
  const find = (name: string) => PRIMARY_DETECTORS.find((d) => d.name === name);

  if (
    f.includes("prisma/schema") ||
    f.includes("drizzle") ||
    f.includes("migrations/") ||
    f.includes("schema.ts") ||
    f.includes("schema.js")
  ) {
    const db = find("database");
    const mu = find("multiuser");
    if (db) triggered.push(db);
    if (mu) triggered.push(mu);
  }

  if (f.includes("auth") || f.includes("middleware") || f.includes("clerk")) {
    const auth = find("auth");
    if (auth) triggered.push(auth);
  }

  if (f.includes("stripe") || f.includes("payment") || f.includes("webhook") || f.includes("billing")) {
    const pay = find("payments");
    if (pay) triggered.push(pay);
  }

  if (f.includes("admin")) {
    const admin = find("admin");
    if (admin) triggered.push(admin);
  }

  if (f.includes("job") || f.includes("worker") || f.includes("queue") || f.includes("cron")) {
    const jobs = find("jobs");
    if (jobs) triggered.push(jobs);
  }

  if (triggered.length === 0) {
    return PRIMARY_DETECTORS;
  }

  return triggered;
}
