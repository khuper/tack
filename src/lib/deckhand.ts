/**
 * The watch-mode deckhand: a small animated scene that shows, at a glance, whether
 * Tack is idle, scanning the repo, or talking to an agent, and how much agent memory
 * has been docked this session.
 *
 * The scene is pixel art. Each terminal cell carries two vertically stacked pixels
 * through the half-block glyphs (▀ ▄ █) with independent foreground and background
 * colours, which is what lets a 7×9-pixel sailor with a cap and breton stripes fit in
 * five rows of text with no dependency beyond the terminal's colour support.
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
  /** Unresolved drift exists: the front crate is flagged. */
  drift: boolean;
  /** False renders a still frame: no motion, no pulse, no swell. */
  animate: boolean;
};

export type DeckhandRun = {
  text: string;
  color?: string;
  backgroundColor?: string;
  dim?: boolean;
  bold?: boolean;
};

export type DeckhandFrame = {
  width: number;
  rows: DeckhandRun[][];
  caption: string;
  /** Where the sailor is and what they are doing, for tests and debugging. */
  sailor: { x: number; forward: boolean; walking: boolean; carrying: boolean };
};

type Cell = {
  ch: string;
  color?: string;
  backgroundColor?: string;
  dim?: boolean;
  bold?: boolean;
};

type Style = Omit<Cell, "ch">;

export const DECKHAND_MIN_WIDTH = 44;
export const DECKHAND_MAX_WIDTH = 76;
/** Text rows: status line, then the pixel canvas. */
export const DECKHAND_ROWS = 7;

const LEFT_GUTTER = 2;
/** Pixel rows in the canvas: sky and sailor (9), deck plank (1), water (2). */
const CANVAS_PX_HEIGHT = 12;
const SPRITE_W = 7;
const SPRITE_H = 9;
/** Crates are 3 pixels wide and 3 tall, stacked three across and two high on the dock. */
const CRATE_PX = 3;
const DOCK_COLUMNS = 3;
const DOCK_ROWS = 2;
const MAX_VISIBLE_CRATES = DOCK_COLUMNS * DOCK_ROWS;
/** Frames for one crossing of the deck (one direction). */
const TRAVEL_FRAMES = 34;
/** Frames the sailor pauses at either end of a delivery. */
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
  plank: "#7c5a3a",
  plankDark: "#5b4128",
  post: "#475569",
  crate: "#f59e0b",
  crateLight: "#fcd34d",
  crateDark: "#b45309",
  flag: "#f87171",
  flagDark: "#b91c1c",
  scan: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#14532d"],
  mcp: ["#a5f3fc", "#67e8f9", "#22d3ee", "#0891b2", "#155e75"],
  idle: ["#cbd5e1", "#94a3b8", "#64748b", "#475569"],
  waterCrest: "#7dd3fc",
  waterLight: "#0ea5e9",
  water: "#0369a1",
  waterDeep: "#1e3a8a",
  // Sailor.
  cap: "#f8fafc",
  capBand: "#1e3a8a",
  skin: "#f5c9a3",
  skinShade: "#d9a071",
  eye: "#0f172a",
  stripeDark: "#1e3a8a",
  stripeLight: "#e2e8f0",
  trousers: "#1e293b",
  boot: "#0f172a",
} as const;

/**
 * Sprite legend. `.` is transparent. Frames are 7 wide by 9 tall; the bottom row is the
 * boots, which stand on the plank.
 */
const SPRITE_INK: Record<string, string> = {
  W: PALETTE.cap,
  N: PALETTE.capBand,
  S: PALETTE.skin,
  s: PALETTE.skinShade,
  E: PALETTE.eye,
  D: PALETTE.stripeDark,
  L: PALETTE.stripeLight,
  T: PALETTE.trousers,
  B: PALETTE.boot,
};

// Facing right. Mirrored for the walk back.
const SAILOR_STAND = [
  "..WWW..",
  ".WWWWW.",
  ".NNNNN.",
  "..SSE..",
  "..sSS..",
  ".SDDDS.",
  ".SLLLS.",
  "..TTT..",
  "..B.B..",
];

const SAILOR_STRIDE = [
  "..WWW..",
  ".WWWWW.",
  ".NNNNN.",
  "..SSE..",
  "..sSS..",
  "SDDDDS.",
  ".LLLLS.",
  "..T.T..",
  ".B...B.",
];

const SAILOR_CARRY_STAND = [
  "..WWW..",
  ".WWWWW.",
  ".NNNNN.",
  "..SSE..",
  "..sSS..",
  "..DDDSS",
  "..LLL..",
  "..TTT..",
  "..B.B..",
];

const SAILOR_CARRY_STRIDE = [
  "..WWW..",
  ".WWWWW.",
  ".NNNNN.",
  "..SSE..",
  "..sSS..",
  "..DDDSS",
  ".LLLL..",
  "..T.T..",
  ".B...B.",
];

type Canvas = (string | null)[][];

function makeCanvas(width: number, height: number): Canvas {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

function px(canvas: Canvas, x: number, y: number, color: string): void {
  const row = canvas[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = color;
}

function blit(canvas: Canvas, sprite: string[], x0: number, y0: number, mirror: boolean): void {
  for (let y = 0; y < sprite.length; y += 1) {
    const line = sprite[y]!;
    for (let x = 0; x < line.length; x += 1) {
      const key = line[x]!;
      if (key === ".") continue;
      const color = SPRITE_INK[key];
      if (!color) continue;
      const dx = mirror ? line.length - 1 - x : x;
      px(canvas, x0 + dx, y0 + y, color);
    }
  }
}

function drawCrate(canvas: Canvas, x0: number, y0: number, flagged: boolean, bright: boolean): void {
  const fill = flagged ? PALETTE.flag : bright ? PALETTE.crateLight : PALETTE.crate;
  const dark = flagged ? PALETTE.flagDark : PALETTE.crateDark;
  const light = flagged ? "#fca5a5" : PALETTE.crateLight;
  for (let y = 0; y < CRATE_PX; y += 1) {
    for (let x = 0; x < CRATE_PX; x += 1) {
      const edge = y === CRATE_PX - 1 || x === CRATE_PX - 1;
      const highlight = y === 0 && x === 0;
      px(canvas, x0 + x, y0 + y, edge ? dark : highlight ? light : fill);
    }
  }
}

/** Half-block encoding: two pixels per cell, top as foreground, bottom as background. */
function canvasToCells(canvas: Canvas, width: number): Cell[][] {
  const rows: Cell[][] = [];
  for (let y = 0; y + 1 < canvas.length; y += 2) {
    const cells: Cell[] = [];
    for (let x = 0; x < width; x += 1) {
      const top = canvas[y]![x];
      const bottom = canvas[y + 1]![x];
      if (!top && !bottom) cells.push({ ch: " " });
      else if (top && bottom && top === bottom) cells.push({ ch: "█", color: top });
      else if (top && bottom) cells.push({ ch: "▀", color: top, backgroundColor: bottom });
      else if (top) cells.push({ ch: "▀", color: top });
      else cells.push({ ch: "▄", color: bottom! });
    }
    rows.push(cells);
  }
  return rows;
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
  return (
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    Boolean(a.dim) === Boolean(b.dim) &&
    Boolean(a.bold) === Boolean(b.bold)
  );
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
      ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
      ...(cell.dim ? { dim: true } : {}),
      ...(cell.bold ? { bold: true } : {}),
    });
  }
  return runs;
}

export function clampDeckhandWidth(columns: number | undefined): number {
  const available = (columns ?? 80) - 4;
  return Math.max(DECKHAND_MIN_WIDTH, Math.min(DECKHAND_MAX_WIDTH, available));
}

/** Smooth ping-pong across [0, 1]: eased so the sailor slows at either end. */
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

function buildStatusRow(state: DeckhandState, tick: number, w: number, colors: readonly string[]): { row: Cell[]; caption: string } {
  const status = blankRow(w);
  put(status, 0, "◆", { color: PALETTE.brand, bold: true });
  put(status, 2, "deckhand", { color: PALETTE.ink, bold: true });
  const pulse = colors[state.animate ? Math.floor(tick / 3) % 4 : 1]!;
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
  return { row: status, caption };
}

export function renderDeckhandFrame(state: DeckhandState, frame: number, width: number): DeckhandFrame {
  const w = Math.max(DECKHAND_MIN_WIDTH, Math.min(DECKHAND_MAX_WIDTH, Math.floor(width)));
  const colors = modeColors(state.mode);
  const animate = state.animate;
  const tick = animate ? frame : 0;

  // Geometry, in pixels horizontally (one pixel per cell) and vertically (two per cell).
  const plankY = SPRITE_H; // pixel row the boots stand on
  const dockWidth = DOCK_COLUMNS * CRATE_PX;
  const dockX = w - dockWidth - 1;
  const postX = dockX - 1;
  const minX = LEFT_GUTTER;
  const maxX = postX - SPRITE_W - CRATE_PX;
  const motion = motionFor(state, tick, minX, maxX);

  const canvas = makeCanvas(w, CANVAS_PX_HEIGHT);

  // --- deck plank, dock and crates ----------------------------------------------
  for (let x = LEFT_GUTTER; x < w; x += 1) {
    px(canvas, x, plankY, x % 6 === 5 ? PALETTE.plankDark : PALETTE.plank);
  }
  for (let y = plankY - DOCK_ROWS * CRATE_PX; y < plankY; y += 1) {
    px(canvas, postX, y, PALETTE.post);
  }

  const visible = Math.min(state.crates, MAX_VISIBLE_CRATES);
  for (let index = 0; index < visible; index += 1) {
    const column = index % DOCK_COLUMNS;
    const level = Math.floor(index / DOCK_COLUMNS);
    const flagged = state.drift && index === 0;
    drawCrate(canvas, dockX + column * CRATE_PX, plankY - (level + 1) * CRATE_PX, flagged, motion.landing && index === visible - 1);
  }
  if (state.drift) {
    // A pennant above the front of the dock.
    const flagX = dockX;
    const top = plankY - (visible === 0 ? 0 : Math.min(DOCK_ROWS, Math.ceil(visible / DOCK_COLUMNS)) * CRATE_PX) - 3;
    px(canvas, flagX, top, PALETTE.flag);
    px(canvas, flagX + 1, top, PALETTE.flag);
    px(canvas, flagX, top + 1, PALETTE.flag);
    px(canvas, flagX, top + 2, PALETTE.flagDark);
    if (visible === 0) drawCrate(canvas, dockX, plankY - CRATE_PX, true, false);
  }

  // --- water: a slow swell with a bright crest that travels under the deck --------
  const phase = animate ? tick * (state.mode === "idle" ? 0.12 : 0.22) : 0;
  for (let x = 0; x < w; x += 1) {
    const swell = Math.sin(x * 0.19 - phase) + 0.35 * Math.sin(x * 0.43 + phase * 0.6);
    px(canvas, x, plankY + 1, swell > 0.55 ? PALETTE.waterCrest : swell > -0.2 ? PALETTE.waterLight : PALETTE.water);
    px(canvas, x, plankY + 2, swell > 0.2 ? PALETTE.water : PALETTE.waterDeep);
  }

  // --- the sailor ---------------------------------------------------------------
  const stride = motion.walking && Math.floor(tick / 2) % 2 === 0;
  // A one-pixel bob on the stride frames sells the walk.
  const bob = stride ? -1 : 0;
  const sprite = motion.carrying ? (stride ? SAILOR_CARRY_STRIDE : SAILOR_CARRY_STAND) : stride ? SAILOR_STRIDE : SAILOR_STAND;
  const spriteY = plankY - SPRITE_H + (stride ? 1 : 0) + bob;
  blit(canvas, sprite, motion.x, spriteY, !motion.forward);
  if (motion.carrying) {
    const crateX = motion.forward ? motion.x + SPRITE_W : motion.x - CRATE_PX;
    drawCrate(canvas, crateX, spriteY + 4, false, false);
  }

  // Sweep beam while scanning, signal ripple while talking to an agent.
  const eyeY = spriteY + 3;
  if (animate && state.mode === "scan" && motion.walking) {
    for (let index = 0; index < 5; index += 1) {
      const bx = motion.forward ? motion.x + SPRITE_W + 1 + index : motion.x - 2 - index;
      px(canvas, bx, eyeY, PALETTE.scan[Math.min(index, PALETTE.scan.length - 1)]!);
    }
  }
  if (animate && state.mode === "mcp") {
    const origin = motion.forward ? motion.x + SPRITE_W + (motion.carrying ? CRATE_PX + 1 : 1) : motion.x - 2;
    const step = motion.forward ? 1 : -1;
    for (let distance = 0; distance < 9; distance += 1) {
      if ((tick - distance) % 4 !== 0) continue;
      const shade = PALETTE.mcp[Math.min(Math.floor(distance / 2), PALETTE.mcp.length - 1)]!;
      px(canvas, origin + distance * step, eyeY - 1 - (distance % 2), shade);
    }
  }

  const { row: status, caption } = buildStatusRow(state, tick, w, colors);
  const rows = [status, ...canvasToCells(canvas, w)].map(toRuns);

  return {
    width: w,
    rows,
    caption,
    sailor: { x: motion.x, forward: motion.forward, walking: motion.walking, carrying: motion.carrying },
  };
}

/** Which scene to show, from the timestamps of the last scan and the last agent event. */
export function deckhandModeAt(now: number, lastAgentEventAt: number | null, lastScanAt: number | null): DeckhandMode {
  if (lastAgentEventAt !== null && now - lastAgentEventAt < 6_000) return "mcp";
  if (lastScanAt !== null && now - lastScanAt < 3_000) return "scan";
  return "idle";
}
