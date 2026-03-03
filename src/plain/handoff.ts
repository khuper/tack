import { blue, bold, green, gray } from "./colors.js";

export function printHandoffPlain(markdownPath: string, jsonPath: string, generatedAt: string): void {
  console.log(green("Handoff generated"));
  console.log(`${gray("Time:")}     ${blue(generatedAt)}`);
  console.log(`${bold("Markdown:")} ${markdownPath}`);
  console.log(`${bold("JSON:")}     ${jsonPath}`);
}
