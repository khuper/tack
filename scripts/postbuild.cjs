const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const rulesSrcDir = path.join(rootDir, "src", "detectors", "rules");
const rulesDestDir = path.join(distDir, "detectors", "rules");
const wasmSrc = path.join(rootDir, "node_modules", "yoga-wasm-web", "dist", "yoga.wasm");
const wasmDest = path.join(distDir, "yoga.wasm");

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function copyFile(src, dest) {
  ensureFileExists(src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyYamlRules(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const files = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name);

  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

copyFile(wasmSrc, wasmDest);
copyYamlRules(rulesSrcDir, rulesDestDir);
