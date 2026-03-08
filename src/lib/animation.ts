type AnimationFlagArgs = Record<string, unknown> & {
  animations?: unknown;
  "no-animations"?: unknown;
};

function parseAnimationPreference(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "on":
    case "true":
      return true;
    case "0":
    case "off":
    case "false":
      return false;
    default:
      return undefined;
  }
}

export function resolveAnimationsEnabled(
  args: AnimationFlagArgs,
  env: NodeJS.ProcessEnv = process.env,
  isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !env.CI)
): boolean {
  if (args["no-animations"]) {
    return false;
  }

  const cliValue = parseAnimationPreference(args.animations);
  if (cliValue !== undefined) {
    return cliValue;
  }

  const envValue = parseAnimationPreference(env.TACK_ANIMATIONS);
  if (envValue !== undefined) {
    return envValue;
  }

  return isInteractive;
}
