import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readFile, fileExists, grepFiles, listProjectFiles } from "../lib/files.js";

const SCHEMA_FILES = [
  "prisma/schema.prisma",
  "src/db/schema.ts",
  "db/schema.ts",
  "src/schema.ts",
  "drizzle/schema.ts",
];

const SCHEMA_PATTERNS = [
  /model\s+Organization\b/i,
  /model\s+Org\b/i,
  /model\s+Team\b/i,
  /model\s+Workspace\b/i,
  /model\s+Tenant\b/i,
  /table\s*\(\s*["']organizations["']/i,
  /table\s*\(\s*["']teams["']/i,
  /table\s*\(\s*["']workspaces["']/i,
  /table\s*\(\s*["']tenants["']/i,
  /organizationId|orgId|teamId|workspaceId|tenantId/,
];

const ROUTE_PATTERNS = [
  /\/org\/|\/organization\/|\/team\/|\/workspace\//,
  /\[orgId\]|\[teamId\]|\[workspaceId\]/,
  /params\.orgId|params\.teamId|params\.workspaceId/,
];

export function detectMultiuser(): DetectorResult {
  try {
    const signals = [];
    const projectFiles = listProjectFiles();

    for (const schemaFile of SCHEMA_FILES) {
      if (!fileExists(schemaFile)) continue;
      const content = readFile(schemaFile);
      if (!content) continue;

      for (const pattern of SCHEMA_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          signals.push(
            createSignal(
              "scope",
              "multi_tenant",
              `${schemaFile} (${match[0]} found)`,
              0.7,
              "Organization/team model in schema"
            )
          );
          break;
        }
      }
    }

    const routeMatches = ROUTE_PATTERNS.flatMap((p) => grepFiles(projectFiles, p, 3));
    if (routeMatches.length > 0) {
      const files = [...new Set(routeMatches.map((m) => m.file))];
      signals.push(
        createSignal("scope", "multi_tenant", files.join(", "), 0.6, "Org/team route patterns found")
      );
    }

    return { name: "multiuser", signals };
  } catch {
    return { name: "multiuser", signals: [] };
  }
}
