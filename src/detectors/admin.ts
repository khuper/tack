import { createSignal, type DetectorResult } from "../lib/signals.js";
import { grepFiles, listProjectFiles } from "../lib/files.js";

const ADMIN_ROUTE_PATTERNS = [
  /\/admin\//,
  /\/dashboard\/admin/,
  /app\/admin\//,
  /pages\/admin\//,
  /src\/routes\/admin/,
];

const ADMIN_MIDDLEWARE_PATTERNS = [
  /isAdmin|requireAdmin|adminOnly|checkAdmin|AdminGuard/,
  /role\s*===?\s*["']admin["']/, 
  /roles?\s*\.includes\s*\(\s*["']admin["']\)/,
];

export function detectAdmin(): DetectorResult {
  try {
    const signals = [];
    const projectFiles = listProjectFiles();

    const adminRouteFiles = projectFiles.filter((f) => ADMIN_ROUTE_PATTERNS.some((p) => p.test(f)));

    if (adminRouteFiles.length > 0) {
      signals.push(
        createSignal(
          "scope",
          "admin_panel",
          adminRouteFiles.slice(0, 5).join(", "),
          0.8,
          `${adminRouteFiles.length} admin route file(s)`
        )
      );
    }

    const middlewareMatches = ADMIN_MIDDLEWARE_PATTERNS.flatMap((p) => grepFiles(projectFiles, p, 5));

    if (middlewareMatches.length > 0 && adminRouteFiles.length === 0) {
      const files = [...new Set(middlewareMatches.map((m) => m.file))];
      signals.push(createSignal("scope", "admin_panel", files.join(", "), 0.6, "Admin guards/middleware found"));
    }

    return { name: "admin", signals };
  } catch {
    return { name: "admin", signals: [] };
  }
}
