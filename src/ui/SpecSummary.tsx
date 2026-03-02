import React from "react";
import { Text, Box } from "ink";
import type { Spec, SpecDiff, DriftState } from "../lib/signals.js";

type Props = {
  spec: Spec;
  diff: SpecDiff;
  drift?: DriftState;
};

export function SpecSummary({ spec, diff, drift }: Props) {
  const unresolvedCount = drift?.items.filter((i) => i.status === "unresolved").length ?? 0;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>tack status — {spec.project}</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          SYSTEMS
        </Text>
        {diff.aligned
          .filter((s) => s.category === "system")
          .map((s) => (
            <Text key={`${s.id}-${s.detail}`}>
              {"  "}
              <Text color="green">✓</Text> {s.id}: {s.detail ?? "detected"} <Text dimColor>(allowed)</Text>
            </Text>
          ))}
        {diff.violations
          .filter((v) => v.type === "forbidden_system")
          .map((v) => (
            <Text key={`${v.signal.id}-${v.signal.source}`}>
              {"  "}
              <Text color="red">✗</Text> {v.signal.id} <Text color="red">(FORBIDDEN — {v.signal.source})</Text>
            </Text>
          ))}
        {diff.undeclared
          .filter((s) => s.category === "system")
          .map((s) => (
            <Text key={`${s.id}-${s.source}`}>
              {"  "}
              <Text color="yellow">?</Text> {s.id}: {s.detail ?? "detected"} <Text color="yellow">(undeclared)</Text>
            </Text>
          ))}
        {diff.missing.map((id) => (
          <Text key={id}>
            {"  "}
            <Text dimColor>-</Text> {id} <Text dimColor>(allowed but not detected)</Text>
          </Text>
        ))}
      </Box>

      {Object.keys(spec.constraints).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            CONSTRAINTS
          </Text>
          {Object.entries(spec.constraints).map(([key, val]) => {
            const mismatch = diff.violations.find(
              (v) => v.type === "constraint_mismatch" && v.spec_rule.includes(key)
            );
            return (
              <Text key={key}>
                {"  "}
                {mismatch ? (
                  <>
                    <Text color="red">✗</Text> {key}: expected {val}, found {mismatch.signal.detail}
                  </>
                ) : (
                  <>
                    <Text color="green">✓</Text> {key}: {val}
                  </>
                )}
              </Text>
            );
          })}
        </Box>
      )}

      {diff.risks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            RISKS
          </Text>
          {diff.risks.map((r) => (
            <Text key={r.id}>
              {"  "}
              <Text color="yellow">⚠</Text> {r.detail ?? r.id}
            </Text>
          ))}
        </Box>
      )}

      {unresolvedCount > 0 && (
        <>
          <Box marginTop={1}>
            <Text bold underline>
              DRIFT
            </Text>
          </Box>
          <Text>
            {"  "}
            {unresolvedCount} unresolved item(s) <Text dimColor>(run tack watch to resolve)</Text>
          </Text>
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>Complexity: {diff.aligned.filter((s) => s.category === "system").length} system(s)</Text>
      </Box>
    </Box>
  );
}
