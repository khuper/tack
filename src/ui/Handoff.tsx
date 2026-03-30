import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import { generateHandoff } from "../engine/handoff.js";
import { log } from "../lib/logger.js";

type HandoffState = {
  markdownPath: string;
  jsonPath: string;
  generatedAt: string;
  handoffId: string;
  handoffTo: string | null;
  handoffStatus: string;
};

export function Handoff({ to }: { to?: string }) {
  const { exit } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HandoffState | null>(null);

  React.useEffect(() => {
    try {
      const generated = generateHandoff({ to });
      setResult({
        markdownPath: generated.markdownPath,
        jsonPath: generated.jsonPath,
        generatedAt: generated.report.generated_at,
        handoffId: generated.report.handoff.id,
        handoffTo: generated.report.handoff.to,
        handoffStatus: generated.report.handoff.lifecycle.status,
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
  }, [exit, to]);

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
      <Text>  ID: {result.handoffId}</Text>
      <Text>  Target: {result.handoffTo ?? "unassigned"}</Text>
      <Text>  Status: {result.handoffStatus}</Text>
      <Text>  Markdown: {result.markdownPath}</Text>
      <Text>  JSON: {result.jsonPath}</Text>
      <Text dimColor>  Give to your agent: .md for chat/context, .json or tack://handoff/latest for structured (MCP).</Text>
    </Box>
  );
}
