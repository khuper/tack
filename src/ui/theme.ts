/**
 * The one palette every Tack screen draws from. Nautical: sky and deep blues for
 * structure and branding, cyan for agent activity, amber for cargo and attention,
 * green only for a confirmed success, red only for errors and forbidden systems.
 *
 * Ink accepts hex colours and chalk degrades them to 256 or 16 colours as the
 * terminal allows; the plain-mode helpers in ../plain/colors.ts carry the same hues
 * as 256-colour codes.
 */
export const theme = {
  /** Logo gradient, sky to deep. */
  brandGradient: ["#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1"],
  /** Primary accent: commands, labels, timestamps, the deckhand marker. */
  primary: "#38bdf8",
  primaryDeep: "#0369a1",
  /** Agent activity: reads, sessions, the MCP badge. */
  agent: "#67e8f9",
  /** Rule checks. */
  check: "#818cf8",
  /** Confirmed success: green checks, write-backs. */
  success: "#4ade80",
  /** Attention: drift counts, warnings, cargo. */
  warning: "#fbbf24",
  /** Errors and forbidden systems. */
  danger: "#f87171",
  /** Secondary text. */
  muted: "#94a3b8",
  /** Borders and rules. */
  border: "#1e40af",
  /** Text drawn on a filled badge. */
  onFill: "#0f172a",
} as const;

export type Tone = "primary" | "agent" | "check" | "success" | "warning" | "danger" | "muted";

export function toneColor(tone: Tone): string {
  return theme[tone];
}
