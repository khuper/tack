import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";

type MascotMode = "idle" | "scan" | "mcp";

type Props = {
  animate: boolean;
  mode: MascotMode;
  cargoCount: number;
  hasDrift: boolean;
};

const MIN_TRACK_WIDTH = 30;
const MAX_TRACK_WIDTH = 58;
const LEFT_MARGIN = 4;
type CellColor = string;

type TrackCell = {
  text: string;
  color?: CellColor;
  backgroundColor?: CellColor;
  dim?: boolean;
  bold?: boolean;
};

type StyleOptions = {
  color?: CellColor;
  backgroundColor?: CellColor;
  dim?: boolean;
  bold?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function place(buffer: TrackCell[], start: number, token: string, style?: StyleOptions): void {
  for (let index = 0; index < token.length; index += 1) {
    const target = start + index;
    if (target < 0 || target >= buffer.length) continue;
    buffer[target] = { text: token[index]!, ...(style ?? {}) };
  }
}

function buildCargoDock(cargoCount: number): string {
  if (cargoCount <= 0) {
    return "[ ]";
  }

  const stack = Math.min(cargoCount, 3);
  return Array.from({ length: stack }, () => "[#]").join("");
}

function buildSprite(mode: MascotMode, direction: -1 | 1, frame: number): { sprite: string; style: StyleOptions } {
  if (mode === "mcp") {
    return {
      sprite: direction === 1 ? "o>[#]" : "[#]<o",
      style: { color: "cyan", bold: true },
    };
  }

  if (mode === "scan") {
    if (direction === 1) {
      return {
        sprite: frame % 2 === 0 ? "o/-" : "o\\-",
        style: { color: "green", bold: true },
      };
    }
    return {
      sprite: frame % 2 === 0 ? "-\\o" : "-/o",
      style: { color: "green", bold: true },
    };
  }

  return {
    sprite: frame % 12 === 0 ? "o_o" : "o|_",
    style: { color: "white", dim: true },
  };
}

function buildCaption(mode: MascotMode, cargoCount: number, hasDrift: boolean, animate: boolean): string {
  if (!animate) {
    return hasDrift ? "deckhand on standby, flagged cargo waiting" : "deckhand on standby";
  }

  if (mode === "mcp") {
    return cargoCount > 1 ? "deckhand sorting agent packages" : "deckhand talking to agents";
  }

  if (mode === "scan") {
    return hasDrift ? "deckhand inspecting suspicious cargo" : "deckhand walking the cargo deck";
  }

  return hasDrift ? "deckhand watching flagged cargo" : "deck clear";
}

export function MascotLane({ animate, mode, cargoCount, hasDrift }: Props) {
  const trackWidth = useMemo(() => {
    const columns = process.stdout.columns ?? 80;
    return clamp(columns - 20, MIN_TRACK_WIDTH, MAX_TRACK_WIDTH);
  }, []);
  const cargoDock = useMemo(() => buildCargoDock(cargoCount), [cargoCount]);
  const maxPosition = Math.max(LEFT_MARGIN, trackWidth - cargoDock.length - 8);
  const [position, setPosition] = useState(LEFT_MARGIN);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [frame, setFrame] = useState(0);
  const directionRef = useRef<1 | -1>(1);
  const tickRef = useRef(0);

  useEffect(() => {
    if (position > maxPosition) {
      setPosition(maxPosition);
    }
  }, [maxPosition, position]);

  useEffect(() => {
    if (!animate) {
      setFrame(0);
      return;
    }

    const intervalMs = mode === "mcp" ? 140 : mode === "scan" ? 180 : 420;
    const timer = setInterval(() => {
      setFrame((previous) => previous + 1);
      tickRef.current += 1;
      const shouldStep = mode === "idle" ? tickRef.current % 2 === 0 : true;
      if (!shouldStep) return;

      setPosition((previous) => {
        let next = previous + directionRef.current;
        if (next < LEFT_MARGIN || next > maxPosition) {
          const reversed = directionRef.current === 1 ? -1 : 1;
          directionRef.current = reversed;
          setDirection(reversed);
          next = previous + reversed;
        }
        return clamp(next, LEFT_MARGIN, maxPosition);
      });
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [animate, maxPosition, mode]);

  useEffect(() => {
    if (mode === "idle") {
      return;
    }

    directionRef.current = 1;
    setDirection(1);
  }, [mode]);

  const visibleMode = animate ? mode : "idle";
  const { sprite, style: spriteStyle } = buildSprite(visibleMode, direction, frame);
  const bubble = visibleMode === "mcp" ? (frame % 6 < 4 ? "..." : " ..") : "";
  const bubbleBuffer = Array.from({ length: trackWidth }, () => ({ text: " " } as TrackCell));
  const deckBuffer = Array.from({ length: trackWidth }, () => ({ text: "_", color: "gray" } as TrackCell));
  const dockStart = trackWidth - cargoDock.length - 2;

  place(deckBuffer, 0, "\\__/", { color: "blue" });
  place(deckBuffer, dockStart, cargoDock, { color: "yellow", bold: true });
  place(deckBuffer, trackWidth - 1, hasDrift ? "!" : "*", { color: hasDrift ? "red" : "gray" });
  if (bubble) {
    place(
      bubbleBuffer,
      position + (direction === 1 ? 1 : 0),
      bubble,
      direction === 1 ? { color: "green", bold: true } : { color: "magenta", bold: true }
    );
  }

  place(deckBuffer, position, sprite, spriteStyle);
  if (animate && cargoCount > 0 && visibleMode === "mcp") {
    place(deckBuffer, clamp(position - 1, 0, trackWidth - 1), "#", { color: "magenta", bold: true });
  }

  const caption = buildCaption(mode, cargoCount, hasDrift, animate);
  const statusColor =
    hasDrift ? "yellow" : visibleMode === "mcp" ? "cyan" : visibleMode === "scan" ? "green" : "gray";

  function renderRow(buffer: TrackCell[]) {
    return (
      <Text>
        {buffer.map((cell, index) => (
          <Text
            key={index}
            color={cell.color ?? undefined}
            backgroundColor={cell.backgroundColor ?? undefined}
            dimColor={cell.dim ?? false}
            bold={cell.bold ?? false}
          >
            {cell.text}
          </Text>
        ))}
      </Text>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>cargo deck</Text>
      {renderRow(bubbleBuffer)}
      {renderRow(deckBuffer)}
      <Text color={statusColor}>{caption}</Text>
    </Box>
  );
}
