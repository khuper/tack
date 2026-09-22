import pc from "picocolors";

/**
 * Plain-mode colours, matched to the Ink theme in ../ui/theme.ts. The 16-colour ANSI
 * "blue" is the unreadable navy on most dark terminals, so the hues are 256-colour
 * codes; when colour is not supported the text passes through untouched.
 */
const CODES = {
  primary: 75, // sky
  agent: 87, // cyan
  success: 78,
  warning: 214, // amber
  danger: 203,
  muted: 245,
} as const;

function paint(code: number, text: string): string {
  return pc.isColorSupported ? `\x1b[38;5;${code}m${text}\x1b[39m` : text;
}

function paintOn(code: number, text: string): string {
  return pc.isColorSupported ? `\x1b[48;5;${code}m\x1b[38;5;16m${text}\x1b[39m\x1b[49m` : text;
}

export function green(text: string): string {
  return paint(CODES.success, text);
}

export function red(text: string): string {
  return paint(CODES.danger, text);
}

export function blue(text: string): string {
  return paint(CODES.primary, text);
}

export function cyan(text: string): string {
  return paint(CODES.agent, text);
}

export function yellow(text: string): string {
  return paint(CODES.warning, text);
}

export function gray(text: string): string {
  return paint(CODES.muted, text);
}

export function bold(text: string): string {
  return pc.bold(text);
}

export function checkBadge(): string {
  return pc.bold(paintOn(CODES.primary, " SCAN "));
}

export function mcpBadge(): string {
  return pc.bold(blue("⚓ tack"));
}
