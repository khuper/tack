const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function wrap(code: string, text: string): string {
  if (!colorEnabled()) return text;
  return `${code}${text}${ANSI.reset}`;
}

export function green(text: string): string {
  return wrap(ANSI.green, text);
}

export function red(text: string): string {
  return wrap(ANSI.red, text);
}

export function blue(text: string): string {
  return wrap(ANSI.blue, text);
}

export function gray(text: string): string {
  return wrap(ANSI.gray, text);
}

export function bold(text: string): string {
  return wrap(ANSI.bold, text);
}
