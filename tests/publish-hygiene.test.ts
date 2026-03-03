import { describe, test, expect } from "bun:test";
import { execSync } from "node:child_process";

describe("publish hygiene", () => {
  test("package includes only allowed files", () => {
    const output = execSync("npm pack --dry-run --json 2>/dev/null", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const [pkg] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const filePaths = pkg.files.map((f) => f.path);

    const banned = [".tack/", "src/", "tests/", ".env"];
    for (const prefix of banned) {
      const leaked = filePaths.filter((p) => p.startsWith(prefix));
      expect(leaked).toEqual([]);
    }
  });
});
