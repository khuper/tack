import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson, fileExists, grepFiles, listProjectFiles } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const AUTH_SYSTEMS: Array<{
  id: string;
  packages: string[];
  routePatterns: RegExp[];
  configFiles: string[];
}> = [
  {
    id: "clerk",
    packages: ["@clerk/nextjs", "@clerk/clerk-react", "@clerk/express"],
    routePatterns: [/clerkMiddleware|ClerkProvider|useAuth|useUser/],
    configFiles: [],
  },
  {
    id: "nextauth",
    packages: ["next-auth", "@auth/core"],
    routePatterns: [/NextAuth|getServerSession|useSession/],
    configFiles: ["auth.ts", "auth.config.ts", "src/auth.ts"],
  },
  {
    id: "auth0",
    packages: ["@auth0/nextjs-auth0", "@auth0/auth0-react", "auth0"],
    routePatterns: [/Auth0Provider|useUser|withPageAuthRequired/],
    configFiles: [],
  },
  {
    id: "supabase-auth",
    packages: ["@supabase/auth-helpers-nextjs", "@supabase/ssr"],
    routePatterns: [/createClientComponentClient|createServerComponentClient/],
    configFiles: [],
  },
  {
    id: "lucia",
    packages: ["lucia", "@lucia-auth/adapter-prisma", "@lucia-auth/adapter-drizzle"],
    routePatterns: [/Lucia|validateSessionCookie/],
    configFiles: [],
  },
  {
    id: "passport",
    packages: ["passport", "passport-local", "passport-google-oauth20"],
    routePatterns: [/passport\.authenticate|passport\.use/],
    configFiles: [],
  },
];

export function detectAuth(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    const projectFiles = listProjectFiles();

    for (const auth of AUTH_SYSTEMS) {
      const foundPkgs = auth.packages.filter((p) => p in allDeps);
      const foundConfig = auth.configFiles.find((f) => fileExists(f));

      let routeMatch: string | undefined;
      if (auth.routePatterns.length > 0) {
        for (const pattern of auth.routePatterns) {
          const matches = grepFiles(projectFiles, pattern, 1);
          if (matches.length > 0) {
            routeMatch = matches[0]!.file;
            break;
          }
        }
      }

      const sources: string[] = [];
      let confidence = 0;

      if (foundPkgs.length > 0) {
        sources.push(`package.json (${foundPkgs.join(", ")})`);
        confidence = 0.8;
      }
      if (foundConfig) {
        sources.push(foundConfig);
        confidence = Math.max(confidence, 0.9);
      }
      if (routeMatch) {
        sources.push(routeMatch);
        confidence = Math.min(confidence + 0.1, 1);
      }
      if (foundPkgs.length > 0 && (foundConfig || routeMatch)) {
        confidence = 1;
      }

      if (sources.length > 0) {
        signals.push(createSignal("system", "auth", sources.join(" + "), confidence, auth.id));
      }
    }

    return { name: "auth", signals };
  } catch {
    return { name: "auth", signals: [] };
  }
}
