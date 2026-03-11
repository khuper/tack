import React from "react";
import { Text, Box } from "ink";
import { readPackageMeta } from "../lib/packageMeta.js";

const LOGO = `
  _____            _
 |_   _|_ _  ___  | |__
   | |/ _\` |/ __| | '_ \\
   | | (_| | (__  | | | |
   |_|\\__,_|\\___| |_| |_|
`;

export function Logo() {
  const pkg = readPackageMeta();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan">{LOGO}</Text>
      <Text dimColor>{`  Compact project memory for coding agents - v${pkg.version}`}</Text>
    </Box>
  );
}
