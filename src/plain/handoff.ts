import { blue, bold, green, gray } from "./colors.js";

export function printHandoffPlain(markdownPath: string, jsonPath: string, generatedAt: string): void {
  console.log(green("Handoff generated"));
  console.log(`${gray("Time:")}     ${blue(generatedAt)}`);
  console.log(`${bold("Markdown:")} ${markdownPath}`);
  console.log(`${bold("JSON:")}     ${jsonPath}`);
  console.log("");
  console.log(
    "Give this to your agent: attach the .md file to your chat (or add it to context in Cursor). For structured use, start with tack://session, then tack://context/workspace, then tack://handoff/latest (MCP)."
  );
}
