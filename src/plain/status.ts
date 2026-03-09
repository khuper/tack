import type { ProjectStatus } from "../lib/signals.js";
import { blue, bold, gray, green, red } from "./colors.js";

export function printStatusPlain(status: ProjectStatus): void {
  const healthy = status.health === "aligned";
  console.log(`${bold("Project:")} ${status.name}`);
  console.log(`${bold("Health:")}  ${healthy ? green(status.health) : red(status.health)}`);
  console.log(`${bold("Drift:")}   ${status.driftCount > 0 ? red(`${status.driftCount} item(s)`) : green("0 item(s)")}`);
  if (status.driftItems.length) {
    for (const item of status.driftItems) {
      console.log(`  - ${red(item.system)}: ${item.message}`);
    }
  }
  console.log(`${gray("Last scan:")} ${blue(status.lastScan ?? "never")}`);
  if (status.memoryWarnings.length > 0) {
    console.log(`${bold("Memory:")} ${red("attention needed")}`);
    for (const warning of status.memoryWarnings) {
      console.log(`  - ${warning}`);
    }
  }
}
