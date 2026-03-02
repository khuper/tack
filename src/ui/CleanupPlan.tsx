import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { generateCleanupPlan } from "../engine/cleanup.js";

type Props = {
  systemId: string;
};

export function CleanupPlan({ systemId }: Props) {
  const plan = useMemo(() => generateCleanupPlan(systemId), [systemId]);

  return (
    <Box flexDirection="column">
      <Text bold>Cleanup plan for: {systemId}</Text>

      {plan.packagesToRemove.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Packages to remove:</Text>
          {plan.packagesToRemove.map((pkg) => (
            <Text key={pkg}>  bun remove {pkg}</Text>
          ))}
        </Box>
      )}

      {plan.configFilesToCheck.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Config files to check:</Text>
          {plan.configFilesToCheck.map((f) => (
            <Text key={f}>  {f}</Text>
          ))}
        </Box>
      )}

      {plan.filesToReview.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Files referencing {systemId}:</Text>
          {plan.filesToReview.slice(0, 15).map((m, i) => (
            <Text key={`${m.file}-${m.line}-${i}`}>
              {"  "}
              <Text dimColor>
                {m.file}:{m.line}
              </Text>{" "}
              {m.content.slice(0, 80)}
            </Text>
          ))}
          {plan.filesToReview.length > 15 && <Text dimColor>{"  "}...and {plan.filesToReview.length - 15} more</Text>}
        </Box>
      )}

      {plan.packagesToRemove.length === 0 && plan.filesToReview.length === 0 && plan.configFilesToCheck.length === 0 && (
        <Text dimColor>No actionable cleanup items found.</Text>
      )}
    </Box>
  );
}
