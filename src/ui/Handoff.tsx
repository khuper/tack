import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import { generateHandoff } from "../engine/handoff.js";
import { log } from "../lib/logger.js";

type HandoffState = {
  markdownPath: string;
  jsonPath: string;
  generatedAt: string;
};

export function Handoff() {
  const { exit } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HandoffState | null>(null);

  React.useEffect(() => {
    try {
      const generated = generateHandoff();
      setResult({
        markdownPath: generated.markdownPath,
        jsonPath: generated.jsonPath,
        generatedAt: generated.report.generated_at,
      });
      log({
        event: "handoff",
        markdown_path: generated.markdownPath,
        json_path: generated.jsonPath,
      });
      setTimeout(() => exit(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate handoff");
      setTimeout(() => exit(), 500);
    }
  }, [exit]);

  if (error) {
    return <Text color="red">✗ {error}</Text>;
  }

  if (!result) {
    return <Text>Generating handoff...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Handoff generated</Text>
      <Text>  Time: {result.generatedAt}</Text>
      <Text>  Markdown: {result.markdownPath}</Text>
      <Text>  JSON: {result.jsonPath}</Text>
      <Text dimColor>  Give to your agent: .md for chat/context, .json or tack://handoff/latest for structured (MCP).</Text>
    </Box>
  );
}
