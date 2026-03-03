export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

export function usePlainOutput(): boolean {
  return Boolean(
    process.env.TACK_PLAIN === "1" ||
      process.argv.includes("--plain") ||
      !process.stdin.isTTY ||
      !process.stdout.isTTY ||
      process.env.CI
  );
}
