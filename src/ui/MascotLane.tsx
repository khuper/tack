import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useStdout } from "ink";
import {
  clampDeckhandWidth,
  DECKHAND_FRAME_MS,
  deckhandModeAt,
  renderDeckhandFrame,
  type DeckhandMode,
  type DeckhandRun,
} from "../lib/deckhand.js";

type Props = {
  /** Whether the scene moves at all. A still frame is rendered when false. */
  animate: boolean;
  /** Agent write-backs seen this session: crates docked on the right. */
  crates: number;
  /** Unresolved drift exists: one crate is flagged. */
  drift: boolean;
  /** Timestamp of the most recent MCP event, or null before any. */
  lastAgentEventAt: number | null;
  /** Timestamp of the most recent repo scan, or null before any. */
  lastScanAt: number | null;
};

function useTerminalColumns(): number | undefined {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState<number | undefined>(stdout.columns);

  useEffect(() => {
    const onResize = () => setColumns(stdout.columns);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return columns;
}

function Row({ runs }: { runs: DeckhandRun[] }) {
  return (
    <Text>
      {runs.map((run, index) => (
        <Text
          key={index}
          color={run.color}
          backgroundColor={run.backgroundColor}
          dimColor={run.dim ?? false}
          bold={run.bold ?? false}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * The animated deckhand shown in `tack watch`. The scene reacts to what the watcher
 * sees: a repo scan sends the deckhand walking the deck, an agent event has them
 * hauling memory to the hold, and each write-back docks a crate.
 */
export function MascotLane({ animate, crates, drift, lastAgentEventAt, lastScanAt }: Props) {
  const columns = useTerminalColumns();
  const width = useMemo(() => clampDeckhandWidth(columns), [columns]);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<DeckhandMode>(() => deckhandModeAt(Date.now(), lastAgentEventAt, lastScanAt));

  // Mode is re-evaluated on the frame clock so the scene calms down by itself a few
  // seconds after the last event, without the parent having to re-render for it.
  useEffect(() => {
    setMode(deckhandModeAt(Date.now(), lastAgentEventAt, lastScanAt));
  }, [lastAgentEventAt, lastScanAt]);

  useEffect(() => {
    if (!animate) {
      setFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setFrame((previous) => previous + 1);
      setMode(deckhandModeAt(Date.now(), lastAgentEventAt, lastScanAt));
    }, DECKHAND_FRAME_MS[mode]);

    return () => {
      clearInterval(timer);
    };
  }, [animate, mode, lastAgentEventAt, lastScanAt]);

  const scene = renderDeckhandFrame({ mode, crates, drift, animate }, frame, width);

  return (
    <Box flexDirection="column" marginTop={1}>
      {scene.rows.map((runs, index) => (
        <Row key={index} runs={runs} />
      ))}
    </Box>
  );
}
