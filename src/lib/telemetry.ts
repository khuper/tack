import { configPath, readJson, statsPath, writeSafe } from "./files.js";

type TelemetryCountKey = "sessions" | "decisions_logged" | "notes_logged" | "briefings_served";

type TelemetryCounts = Record<TelemetryCountKey, number>;

export type TelemetryStats = TelemetryCounts & {
  first_seen: string;
  last_seen: string;
};

export type TelemetryConfig = {
  telemetry_prompted: boolean;
  telemetry_enabled: boolean;
  last_sent_at: string | null;
  sent_totals: TelemetryCounts;
};

type TelemetryPayload = {
  schema_version: "1.0.0";
  sent_at: string;
  counts: TelemetryCounts;
};

const ZERO_COUNTS: TelemetryCounts = {
  sessions: 0,
  decisions_logged: 0,
  notes_logged: 0,
  briefings_served: 0,
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeCounts(value: unknown): TelemetryCounts {
  const raw = typeof value === "object" && value !== null ? (value as Partial<TelemetryCounts>) : {};
  return {
    sessions: normalizeCount(raw.sessions),
    decisions_logged: normalizeCount(raw.decisions_logged),
    notes_logged: normalizeCount(raw.notes_logged),
    briefings_served: normalizeCount(raw.briefings_served),
  };
}

function writeJsonFile(filepath: string, value: unknown): void {
  writeSafe(filepath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultStats(now = todayIsoDate()): TelemetryStats {
  return {
    ...ZERO_COUNTS,
    first_seen: now,
    last_seen: now,
  };
}

function defaultConfig(): TelemetryConfig {
  return {
    telemetry_prompted: false,
    telemetry_enabled: false,
    last_sent_at: null,
    sent_totals: { ...ZERO_COUNTS },
  };
}

export function readTelemetryStats(): TelemetryStats {
  const now = todayIsoDate();
  const raw = readJson<Partial<TelemetryStats>>(".tack/_stats.json");
  if (!raw) {
    return defaultStats(now);
  }

  return {
    ...normalizeCounts(raw),
    first_seen: typeof raw.first_seen === "string" && raw.first_seen.trim() ? raw.first_seen : now,
    last_seen: typeof raw.last_seen === "string" && raw.last_seen.trim() ? raw.last_seen : now,
  };
}

export function writeTelemetryStats(stats: TelemetryStats): void {
  writeJsonFile(statsPath(), stats);
}

export function readTelemetryConfig(): TelemetryConfig {
  const raw = readJson<Partial<TelemetryConfig>>(".tack/_config.json");
  if (!raw) {
    return defaultConfig();
  }

  return {
    telemetry_prompted: Boolean(raw.telemetry_prompted),
    telemetry_enabled: Boolean(raw.telemetry_enabled),
    last_sent_at:
      typeof raw.last_sent_at === "string" && raw.last_sent_at.trim().length > 0 ? raw.last_sent_at : null,
    sent_totals: normalizeCounts(raw.sent_totals),
  };
}

export function writeTelemetryConfig(config: TelemetryConfig): void {
  writeJsonFile(configPath(), config);
}

export function ensureTelemetryState(): void {
  const config = readTelemetryConfig();
  const stats = readTelemetryStats();
  writeTelemetryConfig(config);
  writeTelemetryStats(stats);
}

export function setTelemetryPreference(enabled: boolean): void {
  const config = readTelemetryConfig();
  writeTelemetryConfig({
    ...config,
    telemetry_prompted: true,
    telemetry_enabled: enabled,
  });
}

export function telemetryPromptNeeded(): boolean {
  return !readTelemetryConfig().telemetry_prompted;
}

function getTelemetryEndpoint(): string | null {
  const raw = process.env.TACK_TELEMETRY_ENDPOINT;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw.trim();
}

function telemetryEnvDisabled(): boolean {
  const value = process.env.TACK_TELEMETRY;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

function sameDay(a: string | null, b: string): boolean {
  return typeof a === "string" && a.slice(0, 10) === b.slice(0, 10);
}

function subtractCounts(current: TelemetryCounts, previous: TelemetryCounts): TelemetryCounts {
  return {
    sessions: Math.max(0, current.sessions - previous.sessions),
    decisions_logged: Math.max(0, current.decisions_logged - previous.decisions_logged),
    notes_logged: Math.max(0, current.notes_logged - previous.notes_logged),
    briefings_served: Math.max(0, current.briefings_served - previous.briefings_served),
  };
}

function hasNonZeroCounts(counts: TelemetryCounts): boolean {
  return Object.values(counts).some((value) => value > 0);
}

export function recordTelemetryCounts(delta: Partial<TelemetryCounts>): void {
  const current = readTelemetryStats();
  const today = todayIsoDate();
  const next: TelemetryStats = {
    ...current,
    sessions: current.sessions + normalizeCount(delta.sessions),
    decisions_logged: current.decisions_logged + normalizeCount(delta.decisions_logged),
    notes_logged: current.notes_logged + normalizeCount(delta.notes_logged),
    briefings_served: current.briefings_served + normalizeCount(delta.briefings_served),
    first_seen: current.first_seen || today,
    last_seen: today,
  };

  writeTelemetryStats(next);
  void flushTelemetryIfDue();
}

export async function flushTelemetryIfDue(): Promise<boolean> {
  if (telemetryEnvDisabled()) {
    return false;
  }

  const endpoint = getTelemetryEndpoint();
  if (!endpoint) {
    return false;
  }

  const config = readTelemetryConfig();
  if (!config.telemetry_enabled) {
    return false;
  }

  const nowIso = new Date().toISOString();
  if (sameDay(config.last_sent_at, nowIso)) {
    return false;
  }

  const stats = readTelemetryStats();
  const currentTotals = normalizeCounts(stats);
  const delta = subtractCounts(currentTotals, config.sent_totals);
  if (!hasNonZeroCounts(delta)) {
    writeTelemetryConfig({
      ...config,
      last_sent_at: nowIso,
      sent_totals: currentTotals,
    });
    return false;
  }

  const payload: TelemetryPayload = {
    schema_version: "1.0.0",
    sent_at: nowIso,
    counts: delta,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return false;
    }

    writeTelemetryConfig({
      ...config,
      last_sent_at: nowIso,
      sent_totals: currentTotals,
    });
    return true;
  } catch {
    return false;
  }
}
