import React from "react";
import { Text, Box } from "ink";
import { readPackageMeta } from "../lib/packageMeta.js";
import { theme } from "./theme.js";

const LOGO_LINES = [
  "████████╗ █████╗  ██████╗██╗  ██╗",
  "╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝",
  "   ██║   ███████║██║     █████╔╝",
  "   ██║   ██╔══██║██║     ██╔═██╗",
  "   ██║   ██║  ██║╚██████╗██║  ██╗",
  "   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝",
] as const;
const LOGO_COLORS = theme.brandGradient;

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
      <Text dimColor>{`  Accurate project memory for coding agents - v${pkg.version}`}</Text>
    </Box>
  );
}
