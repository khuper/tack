import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson, fileExists } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const FRAMEWORKS: Array<{
  id: string;
  packages: string[];
  configFiles: string[];
}> = [
  {
    id: "nextjs",
    packages: ["next"],
    configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
  },
  {
    id: "remix",
    packages: ["@remix-run/node", "@remix-run/react"],
    configFiles: ["remix.config.js"],
  },
  {
    id: "sveltekit",
    packages: ["@sveltejs/kit"],
    configFiles: ["svelte.config.js"],
  },
  {
    id: "vite",
    packages: ["vite"],
    configFiles: ["vite.config.ts", "vite.config.js"],
  },
  {
    id: "express",
    packages: ["express"],
    configFiles: [],
  },
  {
    id: "fastify",
    packages: ["fastify"],
    configFiles: [],
  },
  {
    id: "hono",
    packages: ["hono"],
    configFiles: [],
  },
  {
    id: "astro",
    packages: ["astro"],
    configFiles: ["astro.config.mjs", "astro.config.ts"],
  },
];

export function detectFramework(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
    };

    for (const fw of FRAMEWORKS) {
      const foundPkg = fw.packages.find((p) => p in allDeps);
      const foundConfig = fw.configFiles.find((f) => fileExists(f));

      if (foundPkg && foundConfig) {
        signals.push(
          createSignal("system", "framework", `package.json (${foundPkg}) + ${foundConfig}`, 1, fw.id)
        );
      } else if (foundPkg) {
        signals.push(createSignal("system", "framework", `package.json (${foundPkg})`, 0.9, fw.id));
      } else if (foundConfig) {
        signals.push(createSignal("system", "framework", foundConfig, 0.8, fw.id));
      }
    }

    return { name: "framework", signals };
  } catch {
    return { name: "framework", signals: [] };
  }
}
