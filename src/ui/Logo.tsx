import React from "react";
import { Text, Box } from "ink";
import { readPackageMeta } from "../lib/packageMeta.js";

const LOGO_LINES = [
  "████████╗ █████╗  ██████╗██╗  ██╗",
  "╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝",
  "   ██║   ███████║██║     █████╔╝",
  "   ██║   ██╔══██║██║     ██╔═██╗",
  "   ██║   ██║  ██║╚██████╗██║  ██╗",
  "   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝",
] as const;
const LOGO_COLORS = ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d"] as const;

export function Logo() {
  const pkg = readPackageMeta();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <Text key={line} color={LOGO_COLORS[index]}>
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor>{`  Compact project memory for coding agents - v${pkg.version}`}</Text>
    </Box>
  );
}
