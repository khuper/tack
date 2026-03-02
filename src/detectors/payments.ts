import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson, grepFiles, listProjectFiles } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const PAYMENT_SYSTEMS: Array<{
  id: string;
  packages: string[];
  webhookPatterns: RegExp[];
}> = [
  {
    id: "stripe",
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    webhookPatterns: [/stripe\.webhooks\.constructEvent|webhook.*stripe|stripe.*webhook/i],
  },
  {
    id: "paddle",
    packages: ["@paddle/paddle-js", "@paddle/paddle-node-sdk"],
    webhookPatterns: [/paddle.*webhook|webhook.*paddle/i],
  },
  {
    id: "lemonsqueezy",
    packages: ["@lemonsqueezy/lemonsqueezy.js"],
    webhookPatterns: [/lemonsqueezy.*webhook|webhook.*lemonsqueezy/i],
  },
];

export function detectPayments(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    const projectFiles = listProjectFiles();

    for (const payment of PAYMENT_SYSTEMS) {
      const foundPkgs = payment.packages.filter((p) => p in allDeps);
      const webhookFiles = payment.webhookPatterns.flatMap((pattern) => grepFiles(projectFiles, pattern, 3));

      const sources: string[] = [];
      let confidence = 0;

      if (foundPkgs.length > 0) {
        sources.push(`package.json (${foundPkgs.join(", ")})`);
        confidence = 0.8;
      }
      if (webhookFiles.length > 0) {
        const uniqueFiles = [...new Set(webhookFiles.map((m) => m.file))];
        sources.push(...uniqueFiles);
        confidence = Math.min(confidence + 0.2, 1);
      }

      if (sources.length > 0) {
        signals.push(createSignal("system", "payments", sources.join(" + "), confidence, payment.id));
      }
    }

    return { name: "payments", signals };
  } catch {
    return { name: "payments", signals: [] };
  }
}
