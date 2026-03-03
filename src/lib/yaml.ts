import { basename } from "node:path";
import * as fs from "node:fs";
import * as yaml from "js-yaml";

export function safeLoadYaml<T>(filepath: string, fallback: T): { data: T; error: string | null } {
  if (!fs.existsSync(filepath)) {
    return { data: fallback, error: null };
  }

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = fs.readFileSync(filepath, "utf-8");
      const parsed = yaml.load(raw);
      if (parsed === null || parsed === undefined) {
        return { data: fallback, error: null };
      }
      return { data: parsed as T, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lineMatch = message.match(/line (\d+)/i);
      const lineInfo = lineMatch ? ` (line ${lineMatch[1]})` : "";
      lastError = `Failed to parse ${basename(filepath)}${lineInfo}: ${message}`;
    }
  }

  return { data: fallback, error: lastError };
}
