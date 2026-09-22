/**
 * The watch-mode deckhand: a small animated scene that shows, at a glance, whether
 * Tack is idle, scanning the repo, or talking to an agent, and how much agent memory
 * has been docked this session.
 *
 * Everything here is pure: a frame number and a state in, styled text runs out. The
 * Ink component only ticks a counter and paints runs, so every frame is deterministic
 * and testable, and the same frames can be rendered outside a terminal.
 */

export type DeckhandMode = "idle" | "scan" | "mcp";

export type DeckhandState = {
  mode: DeckhandMode;
  /** Agent write-backs docked this session (crates on the dock). */
  crates: number;
  /** Unresolved drift exists: one crate is flagged. */
  drift: boolean;
  /** False renders a still frame: no motion, no pulse, no wave. */
  animate: boolean;
};

export type DeckhandRun = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
};

export type DeckhandFrame = {
  width: number;
  rows: DeckhandRun[][];
  caption: string;
};

type Cell = {
  ch: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
};

type Style = Omit<Cell, "ch">;

export const DECKHAND_MIN_WIDTH = 44;
export const DECKHAND_MAX_WIDTH = 76;
const LEFT_GUTTER = 2;
const DOCK_CRATES_WIDE = 3;
const MAX_VISIBLE_CRATES = 5;
/** Frames for one crossing of the deck (one direction). */
const TRAVEL_FRAMES = 34;
/** Frames the deckhand pauses at either end of a delivery. */
const PAUSE_FRAMES = 6;

/** Frame intervals in milliseconds, per mode. */
export const DECKHAND_FRAME_MS: Record<DeckhandMode, number> = {
  idle: 220,
  scan: 85,
  mcp: 85,
};

const PALETTE = {
  brand: "#4ade80",
  ink: "#e2e8f0",
  mute: "#94a3b8",
  rail: "#334155",
  railEnd: "#475569",
  wall: "#64748b",
  crate: "#f59e0b",
  crateBright: "#fbbf24",
  flag: "#f87171",
  scan: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#14532d"],
  mcp: ["#a5f3fc", "#67e8f9", "#22d3ee", "#0891b2", "#155e75"],
  idle: ["#cbd5e1", "#94a3b8", "#64748b", "#475569"],
  water: ["#172554", "#1e3a8a", "#1e40af", "#0369a1", "#0284c7", "#0ea5e9"],
} as const;

const WAVE_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"] as const;

export function clampDeckhandWidth(columns: number | undefined): number {
  const available = (columns ?? 80) - 4;
  return Math.max(DECKHAND_MIN_WIDTH, Math.min(DECKHAND_MAX_WIDTH, available));
}

function blankRow(width: number): Cell[] {
  return Array.from({ length: width }, () => ({ ch: " " }));
}

function put(row: Cell[], start: number, text: string, style: Style = {}): void {
  for (let index = 0; index < text.length; index += 1) {
    const target = start + index;
    if (target < 0 || target >= row.length) continue;
    row[target] = { ch: text[index]!, ...style };
  }
}

function sameStyle(a: Style, b: Style): boolean {
  return a.color === b.color && Boolean(a.dim) === Boolean(b.dim) && Boolean(a.bold) === Boolean(b.bold);
}

function toRuns(row: Cell[]): DeckhandRun[] {
  const runs: DeckhandRun[] = [];
  for (const cell of row) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, cell) && last.text.length < 64) {
      last.text += cell.ch;
      continue;
    }
    runs.push({
      text: cell.ch,
      ...(cell.color ? { color: cell.color } : {}),
      ...(cell.dim ? { dim: true } : {}),
      ...(cell.bold ? { bold: true } : {}),
    });
  }
  return runs;
}

/** Smooth ping-pong across [0, 1]: eased so the deckhand slows at either end. */
function easedPingPong(frame: number, period: number): { t: number; forward: boolean } {
  const cycle = frame % (2 * period);
  const forward = cycle < period;
  const linear = (forward ? cycle : 2 * period - cycle) / period;
  const t = 0.5 - 0.5 * Math.cos(Math.PI * linear);
  return { t, forward };
}

type Motion = {
  x: number;
  forward: boolean;
  walking: boolean;
  carrying: boolean;
  /** True on the frames right after a crate lands on the dock. */
  landing: boolean;
};

function motionFor(state: DeckhandState, frame: number, minX: number, maxX: number): Motion {
  if (!state.animate || state.mode === "idle") {
    return { x: minX, forward: true, walking: false, carrying: false, landing: false };
  }

  if (state.mode === "scan") {
    const { t, forward } = easedPingPong(frame, TRAVEL_FRAMES);
    return { x: minX + Math.round(t * (maxX - minX)), forward, walking: true, carrying: false, landing: false };
  }

  // Delivery loop: carry a crate to the dock, pause, walk back empty-handed, pause.
  const cycleLength = 2 * (TRAVEL_FRAMES + PAUSE_FRAMES);
  const cycle = frame % cycleLength;
  if (cycle < TRAVEL_FRAMES) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * cycle) / TRAVEL_FRAMES);
    return { x: minX + Math.round(t * (maxX - minX)), forward: true, walking: true, carrying: true, landing: false };
  }
  if (cycle < TRAVEL_FRAMES + PAUSE_FRAMES) {
    return { x: maxX, forward: true, walking: false, carrying: false, landing: cycle - TRAVEL_FRAMES < 3 };
  }
  if (cycle < 2 * TRAVEL_FRAMES + PAUSE_FRAMES) {
    const back = cycle - TRAVEL_FRAMES - PAUSE_FRAMES;
    const t = 0.5 - 0.5 * Math.cos((Math.PI * back) / TRAVEL_FRAMES);
    return { x: maxX - Math.round(t * (maxX - minX)), forward: false, walking: true, carrying: false, landing: false };
  }
  return { x: minX, forward: false, walking: false, carrying: false, landing: false };
}

function modeColors(mode: DeckhandMode): readonly string[] {
  return mode === "scan" ? PALETTE.scan : mode === "mcp" ? PALETTE.mcp : PALETTE.idle;
}

function captionFor(state: DeckhandState): string {
  if (!state.animate) {
    return state.drift ? "on standby, flagged cargo waiting" : "on standby";
  }
  if (state.mode === "mcp") {
    return state.drift ? "hauling agent memory past flagged cargo" : "hauling agent memory to the hold";
  }
  if (state.mode === "scan") {
    return state.drift ? "inspecting flagged cargo" : "walking the deck";
  }
  return state.drift ? "deck quiet, flagged cargo waiting" : "deck quiet, waiting for agents";
}

export function renderDeckhandFrame(state: DeckhandState, frame: number, width: number): DeckhandFrame {
  const w = Math.max(DECKHAND_MIN_WIDTH, Math.min(DECKHAND_MAX_WIDTH, Math.floor(width)));
  const colors = modeColors(state.mode);
  const animate = state.animate;
  const tick = animate ? frame : 0;

  const status = blankRow(w);
  const air = blankRow(w);
  const body = blankRow(w);
  const deck = blankRow(w);
  const water = blankRow(w);

  // Geometry: rail from the gutter to the dock wall, crates stacked against the right edge.
  const dockStart = w - DOCK_CRATES_WIDE - 1;
  const wallX = dockStart - 1;
  const minX = LEFT_GUTTER;
  const maxX = wallX - 5;
  const motion = motionFor(state, tick, minX, maxX);

  // --- status row -------------------------------------------------------------
  put(status, 0, "◆", { color: PALETTE.brand, bold: true });
  put(status, 2, "deckhand", { color: PALETTE.ink, bold: true });
  const pulse = colors[animate ? Math.floor(tick / 3) % 4 : 1]!;
  put(status, 12, "●", { color: pulse, bold: true });
  // Right-hand labels come in a long and a compact form; whichever fits beside the
  // caption is used, and the caption itself is clipped with an ellipsis if it must be.
  const longCrates = state.crates > 0 ? `▣ ${state.crates} ${state.crates === 1 ? "crate" : "crates"} docked` : "▣ hold empty";
  const shortCrates = state.crates > 0 ? `▣ ${state.crates}` : "▣ 0";
  const driftLabel = state.drift ? "▲ drift" : "";
  const shortDrift = state.drift ? "▲" : "";
  const captionStart = 14;
  const fullCaption = captionFor(state);
  const candidates: Array<[string, string]> = [
    [longCrates, driftLabel],
    [shortCrates, shortDrift],
  ];
  let crateLabel = shortCrates;
  let flagLabel = shortDrift;
  let rightWidth = 0;
  for (const [index, [crates, flag]] of candidates.entries()) {
    const width = crates.length + (flag ? flag.length + 2 : 0);
    // The long labels are only worth it when the whole caption still fits beside them;
    // the compact ones may clip a long caption down to a readable stub.
    const captionNeeded = index === 0 ? fullCaption.length : Math.min(fullCaption.length, 16);
    if (captionStart + captionNeeded + 2 + width <= w) {
      crateLabel = crates;
      flagLabel = flag;
      rightWidth = width;
      break;
    }
  }
  const captionRoom = w - captionStart - (rightWidth > 0 ? rightWidth + 2 : 0);
  const caption =
    fullCaption.length <= captionRoom ? fullCaption : `${fullCaption.slice(0, Math.max(0, captionRoom - 1)).trimEnd()}…`;
  put(status, captionStart, caption, { color: colors[1] });
  if (rightWidth > 0) {
    const rightStart = w - rightWidth;
    put(status, rightStart, crateLabel, state.crates > 0 ? { color: PALETTE.crate } : { color: PALETTE.mute, dim: true });
    if (flagLabel) put(status, rightStart + crateLabel.length + 2, flagLabel, { color: PALETTE.flag, bold: true });
  }

  // --- deck rail, wall and dock ------------------------------------------------
  put(deck, LEFT_GUTTER, "╶", { color: PALETTE.railEnd });
  for (let x = LEFT_GUTTER + 1; x < wallX; x += 1) put(deck, x, "─", { color: PALETTE.rail });
  put(deck, wallX, "┃", { color: PALETTE.wall });
  put(body, wallX, "┃", { color: PALETTE.wall });

  const visible = Math.min(state.crates, MAX_VISIBLE_CRATES);
  const lower = Math.min(visible, DOCK_CRATES_WIDE);
  const upper = visible - lower;
  const crateColor = motion.landing ? PALETTE.crateBright : PALETTE.crate;
  for (let index = 0; index < lower; index += 1) {
    put(deck, dockStart + index, "▣", { color: crateColor, bold: true });
  }
  for (let index = 0; index < upper; index += 1) {
    put(body, dockStart + index, "▣", { color: crateColor, bold: true });
  }
  for (let index = lower; index < DOCK_CRATES_WIDE; index += 1) {
    put(deck, dockStart + index, "▢", { color: PALETTE.rail, dim: true });
  }
  if (state.drift) {
    // The flagged crate sits at the front of the dock, with a marker above it.
    const flagX = dockStart + Math.max(0, lower - 1);
    put(deck, flagX, "▣", { color: PALETTE.flag, bold: true });
    if (upper === 0 || flagX >= dockStart + upper) {
      put(body, flagX, "▲", { color: PALETTE.flag, bold: true });
    } else {
      put(air, flagX, "▲", { color: PALETTE.flag, bold: true });
    }
  }

  // --- water --------------------------------------------------------------------
  // A long, slow swell travelling under the deck: one low-frequency sine with a faint
  // second harmonic so crests are not perfectly regular. Kept low and dim so it reads
  // as a gradient band under the scene, not as a bar chart.
  const phase = animate ? tick * (state.mode === "idle" ? 0.12 : 0.22) : 0;
  for (let x = 0; x < w; x += 1) {
    const swell = Math.sin(x * 0.19 - phase) + 0.35 * Math.sin(x * 0.43 + phase * 0.6);
    const level = 2 + 1.6 * swell;
    const index = Math.max(0, Math.min(4, Math.round(level)));
    put(water, x, WAVE_GLYPHS[index]!, { color: PALETTE.water[index + 1], dim: index < 2 });
  }

  // --- the deckhand ---------------------------------------------------------------
  const x = motion.x;
  const headColor = animate && state.mode === "idle" ? PALETTE.idle[Math.floor(tick / 8) % 2]! : colors[0]!;
  const armColor = colors[2]!;
  const legColor = colors[3]!;

  if (motion.carrying) {
    if (motion.forward) {
      put(body, x, "╭", { color: armColor });
      put(body, x + 1, "●", { color: headColor, bold: true });
      put(body, x + 2, "▣", { color: PALETTE.crate, bold: true });
    } else {
      put(body, x, "▣", { color: PALETTE.crate, bold: true });
      put(body, x + 1, "●", { color: headColor, bold: true });
      put(body, x + 2, "╮", { color: armColor });
    }
  } else {
    put(body, x, "╭", { color: armColor });
    put(body, x + 1, "●", { color: headColor, bold: true });
    put(body, x + 2, "╮", { color: armColor });
  }

  const stride = motion.walking && Math.floor(tick / 2) % 2 === 0;
  if (stride) {
    put(deck, x, "╱", { color: legColor, bold: true });
    put(deck, x + 1, " ");
    put(deck, x + 2, "╲", { color: legColor, bold: true });
  } else {
    put(deck, x + 1, "┃", { color: legColor, bold: true });
  }

  // --- air row: sweep beam while scanning, signal ripple while talking to an agent ---
  if (animate && state.mode === "scan" && motion.walking) {
    const beam = ["━", "━", "╸"];
    for (let index = 0; index < beam.length; index += 1) {
      const bx = motion.forward ? x + 3 + index : x - 1 - index;
      put(air, bx, motion.forward ? beam[index]! : beam[index] === "╸" ? "╺" : beam[index]!, {
        color: PALETTE.scan[Math.min(index + 1, PALETTE.scan.length - 1)],
        bold: index === 0,
      });
    }
  }
  if (animate && state.mode === "mcp") {
    // Dots ripple away from the deckhand toward wherever they are headed.
    const origin = motion.forward ? x + 3 : x - 1;
    const step = motion.forward ? 1 : -1;
    for (let distance = 0; distance < 7; distance += 1) {
      if ((tick - distance) % 4 !== 0) continue;
      const shade = PALETTE.mcp[Math.min(Math.floor(distance / 2), PALETTE.mcp.length - 1)]!;
      put(air, origin + distance * step, distance % 2 === 0 ? "•" : "·", { color: shade, bold: distance < 2 });
    }
  }

  return {
    width: w,
    rows: [status, air, body, deck, water].map(toRuns),
    caption,
  };
}

/** Which scene to show, from the timestamps of the last scan and the last agent event. */
export function deckhandModeAt(now: number, lastAgentEventAt: number | null, lastScanAt: number | null): DeckhandMode {
  if (lastAgentEventAt !== null && now - lastAgentEventAt < 6_000) return "mcp";
  if (lastScanAt !== null && now - lastScanAt < 3_000) return "scan";
  return "idle";
}
