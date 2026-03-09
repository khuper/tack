import pc from "picocolors";

export function green(text: string): string {
  return pc.green(text);
}

export function red(text: string): string {
  return pc.red(text);
}

export function blue(text: string): string {
  return pc.blue(text);
}

export function cyan(text: string): string {
  return pc.cyan(text);
}

export function yellow(text: string): string {
  return pc.yellow(text);
}

export function gray(text: string): string {
  return pc.gray(text);
}

export function bold(text: string): string {
  return pc.bold(text);
}

export function checkBadge(): string {
  return pc.bgYellow(pc.black(" CHECK "));
}

export function mcpBadge(): string {
  return pc.bold(pc.cyan("⚡ tack"));
}
