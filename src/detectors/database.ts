import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson, readFile, fileExists } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ORM_SYSTEMS: Array<{
  id: string;
  packages: string[];
  configFiles: string[];
  dbTypeExtractor?: ((configContent: string) => string | null) | null;
}> = [
  {
    id: "prisma",
    packages: ["prisma", "@prisma/client"],
    configFiles: ["prisma/schema.prisma"],
    dbTypeExtractor: (content) => {
      const match = content.match(
        /provider\s*=\s*"(postgresql|mysql|sqlite|mongodb|sqlserver|cockroachdb)"/
      );
      return match?.[1] ?? null;
    },
  },
  {
    id: "drizzle",
    packages: ["drizzle-orm", "drizzle-kit"],
    configFiles: ["drizzle.config.ts", "drizzle.config.js"],
    dbTypeExtractor: (content) => {
      if (content.includes("pg") || content.includes("postgres")) return "postgres";
      if (content.includes("mysql")) return "mysql";
      if (content.includes("sqlite") || content.includes("better-sqlite")) return "sqlite";
      return null;
    },
  },
  {
    id: "typeorm",
    packages: ["typeorm"],
    configFiles: ["ormconfig.json", "ormconfig.ts", "ormconfig.js"],
    dbTypeExtractor: null,
  },
  {
    id: "mongoose",
    packages: ["mongoose"],
    configFiles: [],
    dbTypeExtractor: () => "mongodb",
  },
  {
    id: "knex",
    packages: ["knex"],
    configFiles: ["knexfile.js", "knexfile.ts"],
    dbTypeExtractor: null,
  },
];

const DB_DRIVERS: Array<{ pkg: string; dbType: string }> = [
  { pkg: "pg", dbType: "postgres" },
  { pkg: "mysql2", dbType: "mysql" },
  { pkg: "better-sqlite3", dbType: "sqlite" },
  { pkg: "mongodb", dbType: "mongodb" },
  { pkg: "@libsql/client", dbType: "sqlite" },
  { pkg: "@neondatabase/serverless", dbType: "postgres" },
  { pkg: "@planetscale/database", dbType: "mysql" },
];

export function detectDatabase(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

    for (const orm of ORM_SYSTEMS) {
      const foundPkgs = orm.packages.filter((p) => p in allDeps);
      if (foundPkgs.length === 0) continue;

      let dbType: string | null = null;
      let configSource: string | null = null;

      for (const cf of orm.configFiles) {
        if (fileExists(cf)) {
          configSource = cf;
          if (orm.dbTypeExtractor) {
            const content = readFile(cf);
            if (content) dbType = orm.dbTypeExtractor(content);
          }
          break;
        }
      }

      if (!dbType && orm.id !== "mongoose") {
        for (const driver of DB_DRIVERS) {
          if (driver.pkg in allDeps) {
            dbType = driver.dbType;
            break;
          }
        }
      }

      const detail = dbType ? `${orm.id} + ${dbType}` : orm.id;
      const sources = [`package.json (${foundPkgs.join(", ")})`];
      if (configSource) sources.push(configSource);

      signals.push(
        createSignal("system", "db", sources.join(" + "), configSource ? 1 : 0.8, detail)
      );
    }

    return { name: "database", signals };
  } catch {
    return { name: "database", signals: [] };
  }
}
