import { createSignal, type DetectorResult } from "../lib/signals.js";
import { readJson } from "../lib/files.js";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const EXPORT_PACKAGES: Array<{ pkg: string; detail: string }> = [
  { pkg: "jspdf", detail: "jspdf" },
  { pkg: "pdfkit", detail: "pdfkit" },
  { pkg: "@react-pdf/renderer", detail: "react-pdf" },
  { pkg: "puppeteer", detail: "puppeteer" },
  { pkg: "playwright", detail: "playwright" },
  { pkg: "html2canvas", detail: "html2canvas" },
  { pkg: "exceljs", detail: "exceljs" },
  { pkg: "xlsx", detail: "sheetjs" },
  { pkg: "csv-writer", detail: "csv-writer" },
  { pkg: "csv-stringify", detail: "csv-stringify" },
  { pkg: "json2csv", detail: "json2csv" },
];

export function detectExports(): DetectorResult {
  try {
    const signals = [];
    const pkg = readJson<PkgJson>("package.json");
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

    const found = EXPORT_PACKAGES.filter((e) => e.pkg in allDeps);
    if (found.length > 0) {
      signals.push(
        createSignal(
          "system",
          "exports",
          `package.json (${found.map((f) => f.pkg).join(", ")})`,
          0.9,
          found.map((f) => f.detail).join(", ")
        )
      );
    }

    return { name: "exports", signals };
  } catch {
    return { name: "exports", signals: [] };
  }
}
