import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";

test("package includes only allowed files", () => {
  const cacheDir = ".npm-cache";
  const output =
    process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/s", "/c", `npm.cmd pack --dry-run --json --cache ${cacheDir}`], {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("npm", ["pack", "--dry-run", "--json", "--cache", cacheDir], {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        });

  const [pkg] = JSON.parse(output);
  const filePaths = pkg.files.map((file) => file.path);

  const bannedPrefixes = [".tack/", "src/", "tests/", ".env"];
  for (const prefix of bannedPrefixes) {
    const leaked = filePaths.filter((filepath) => filepath.startsWith(prefix));
    assert.deepStrictEqual(leaked, [], `package tarball leaked files under ${prefix}`);
  }
});
