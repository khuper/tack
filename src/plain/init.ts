import * as path from "node:path";
import { runAllDetectors } from "../detectors/index.js";
import {
  ensureTackIntegrity,
  ensureContextTemplates,
  ensureTackDir,
  projectRoot,
  specExists,
  writeAudit,
  writeDrift,
  writeSpec,
} from "../lib/files.js";
import { log } from "../lib/logger.js";
import { createAudit, createEmptySpec } from "../lib/signals.js";
import { getProjectName } from "../lib/project.js";

export function runInitPlain(): boolean {
  if (specExists()) {
    const { repaired } = ensureTackIntegrity();
    if (repaired.length > 0) {
      log({ event: "repair", files: repaired });
      console.log(`✓ Repaired .tack integrity (${repaired.length} file(s))`);
      console.log(`Files recreated: ${repaired.join(", ")}`);
      return true;
    }
    console.error("⚠ .tack already initialized. Run 'tack status' instead.");
    return true;
  }

  ensureTackDir();
  ensureContextTemplates();

  const { signals } = runAllDetectors();
  const projectName = getProjectName() || path.basename(projectRoot()) || "my-project";
  const spec = createEmptySpec(projectName);

  const inferredAllowed = Array.from(
    new Set(signals.filter((s) => s.category === "system" || s.category === "scope").map((s) => s.id))
  );
  spec.allowed_systems = inferredAllowed;

  writeSpec(spec);
  writeAudit(createAudit(signals));
  writeDrift({ items: [] });
  log({
    event: "init",
    spec_seeded: true,
    systems_detected: signals.filter((s) => s.category === "system").length,
  });

  console.log("✓ Initialized /.tack/");
  console.log(`Project: ${projectName}`);
  if (inferredAllowed.length > 0) {
    console.log(`Allowed systems (seeded): ${inferredAllowed.join(", ")}`);
  } else {
    console.log("Allowed systems (seeded): none detected");
  }
  console.log('Run "tack status" for a scan or "tack watch" for live monitoring.');

  return true;
}
