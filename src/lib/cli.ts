import { tackDirExists } from "./files.js";

/**
 * Returns the default command when `tack` is invoked with no arguments:
 * - "init" when .tack/ does not exist
 * - "watch" when .tack/ exists
 */
export function getDefaultCommand(
  tackExists: () => boolean = tackDirExists,
): "init" | "watch" {
  return tackExists() ? "watch" : "init";
}
