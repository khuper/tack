import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson, fileExists } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const JOB_SYSTEMS: Array<{
  id: string;
  packages: string[];
  directories: string[];
}> = [
  {
    id: "bullmq",
    packages: ["bullmq", "bull"],
    directories: ["src/jobs", "src/workers", "workers", "jobs", "src/queues", "queues"],
  },
  {
    id: "agenda",
    packages: ["agenda"],
    directories: ["src/jobs", "jobs"],
  },
  {
    id: "cron",
    packages: ["node-cron", "cron"],
    directories: ["src/cron", "cron"],
  },
  {
    id: "temporal",
    packages: ["@temporalio/client", "@temporalio/worker"],
    directories: ["src/workflows", "src/activities"],
  },
  {
    id: "inngest",
    packages: ["inngest"],
    directories: [],
  },
  {
    id: "trigger",
    packages: ["@trigger.dev/sdk"],
    directories: ["src/trigger", "trigger"],
  },
];

export function detectJobs(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

    for (const system of JOB_SYSTEMS) {
      const foundPkgs = system.packages.filter((p) => p in allDeps);
      const foundDirs = system.directories.filter((d) => fileExists(d));

      const sources: string[] = [];
      let confidence = 0;

      if (foundPkgs.length > 0) {
        sources.push(`package.json (${foundPkgs.join(", ")})`);
        confidence = 0.8;
      }
      if (foundDirs.length > 0) {
        sources.push(...foundDirs);
        confidence = Math.min(confidence + 0.2, 1);
      }

      if (sources.length > 0) {
        signals.push(
          createSignal("system", "background_jobs", sources.join(" + "), confidence, system.id)
        );
      }
    }

    return { name: "jobs", signals };
  } catch {
    return { name: "jobs", signals: [] };
  }
}
