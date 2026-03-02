import { grepFiles, listProjectFiles, readJson, fileExists } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type CleanupPlan = {
  system: string;
  packagesToRemove: string[];
  filesToReview: Array<{ file: string; line: number; content: string }>;
  configFilesToCheck: string[];
  summary: string;
};

const SYSTEM_CLEANUP_MAP: Record<
  string,
  {
    packages: string[];
    grepPatterns: RegExp[];
    configFiles: string[];
  }
> = {
  auth: {
    packages: [
      "@clerk/nextjs",
      "@clerk/clerk-react",
      "next-auth",
      "@auth/core",
      "@auth0/nextjs-auth0",
      "passport",
      "lucia",
      "@supabase/auth-helpers-nextjs",
    ],
    grepPatterns: [/ClerkProvider|NextAuth|Auth0Provider|passport\.authenticate|Lucia/],
    configFiles: ["auth.ts", "auth.config.ts", "src/auth.ts", "middleware.ts"],
  },
  payments: {
    packages: [
      "stripe",
      "@stripe/stripe-js",
      "@stripe/react-stripe-js",
      "@paddle/paddle-js",
      "@lemonsqueezy/lemonsqueezy.js",
    ],
    grepPatterns: [/stripe|Stripe|paddle|lemonSqueezy/i],
    configFiles: [],
  },
  db: {
    packages: [
      "prisma",
      "@prisma/client",
      "drizzle-orm",
      "drizzle-kit",
      "typeorm",
      "mongoose",
      "knex",
      "pg",
      "mysql2",
    ],
    grepPatterns: [/prisma|drizzle|typeorm|mongoose|knex/i],
    configFiles: ["prisma/schema.prisma", "drizzle.config.ts", "ormconfig.json"],
  },
  multi_tenant: {
    packages: [],
    grepPatterns: [/Organization|orgId|teamId|workspaceId|tenantId/],
    configFiles: ["prisma/schema.prisma"],
  },
  admin_panel: {
    packages: [],
    grepPatterns: [/isAdmin|requireAdmin|adminOnly|AdminGuard/],
    configFiles: [],
  },
  background_jobs: {
    packages: ["bullmq", "bull", "agenda", "node-cron", "cron", "inngest", "@trigger.dev/sdk"],
    grepPatterns: [/Queue|Worker|Bull|agenda|cron\.schedule/i],
    configFiles: [],
  },
  exports: {
    packages: ["jspdf", "pdfkit", "@react-pdf/renderer", "puppeteer", "playwright", "exceljs", "xlsx"],
    grepPatterns: [/jsPDF|PDFDocument|renderToStream/],
    configFiles: [],
  },
};

export function generateCleanupPlan(systemId: string): CleanupPlan {
  const mapping = SYSTEM_CLEANUP_MAP[systemId];

  if (!mapping) {
    return {
      system: systemId,
      packagesToRemove: [],
      filesToReview: [],
      configFilesToCheck: [],
      summary: `No cleanup mapping found for system "${systemId}". Manual review required.`,
    };
  }

  const pkg = readJson<PkgJson>("package.json");
  const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  const packagesToRemove = mapping.packages.filter((p) => p in allDeps);

  const projectFiles = listProjectFiles();
  const filesToReview = mapping.grepPatterns.flatMap((pattern) => grepFiles(projectFiles, pattern, 20));

  const uniqueFiles = new Map<string, (typeof filesToReview)[0]>();
  for (const match of filesToReview) {
    const key = `${match.file}:${match.line}`;
    if (!uniqueFiles.has(key)) uniqueFiles.set(key, match);
  }

  const configFilesToCheck = mapping.configFiles.filter((f) => fileExists(f));

  const summary = [
    packagesToRemove.length > 0 ? `Remove ${packagesToRemove.length} package(s): ${packagesToRemove.join(", ")}` : null,
    uniqueFiles.size > 0 ? `Review ${uniqueFiles.size} file reference(s)` : null,
    configFilesToCheck.length > 0 ? `Check ${configFilesToCheck.length} config file(s)` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    system: systemId,
    packagesToRemove,
    filesToReview: Array.from(uniqueFiles.values()),
    configFilesToCheck,
    summary: summary || "No cleanup actions identified.",
  };
}
