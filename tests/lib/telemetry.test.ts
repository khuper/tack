import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ensureTelemetryState,
  flushTelemetryIfDue,
  readTelemetryConfig,
  readTelemetryStats,
  recordTelemetryCounts,
  setTelemetryPreference,
} from "../../src/lib/telemetry.js";
import { ensureTackDir } from "../../src/lib/files.js";

let originalCwd = "";
let originalFetch: typeof globalThis.fetch;
let originalEndpoint = "";
let originalTelemetry = "";
let tmpDir = "";

describe("telemetry", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    originalFetch = globalThis.fetch;
    originalEndpoint = process.env.TACK_TELEMETRY_ENDPOINT ?? "";
    originalTelemetry = process.env.TACK_TELEMETRY ?? "";

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tack-telemetry-"));
    process.chdir(tmpDir);
    fs.mkdirSync(path.join(tmpDir, ".git", "info"), { recursive: true });
    ensureTackDir();
    ensureTelemetryState();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;

    if (originalEndpoint) {
      process.env.TACK_TELEMETRY_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.TACK_TELEMETRY_ENDPOINT;
    }

    if (originalTelemetry) {
      process.env.TACK_TELEMETRY = originalTelemetry;
    } else {
      delete process.env.TACK_TELEMETRY;
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records local cumulative stats without needing network", () => {
    recordTelemetryCounts({ sessions: 1, briefings_served: 1, notes_logged: 2, decisions_logged: 1 });

    const stats = readTelemetryStats();
    expect(stats.sessions).toBe(1);
    expect(stats.briefings_served).toBe(1);
    expect(stats.notes_logged).toBe(2);
    expect(stats.decisions_logged).toBe(1);
    expect(stats.first_seen).toBeTruthy();
    expect(stats.last_seen).toBeTruthy();
  });

  it("sends only anonymous deltas after opt-in", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    process.env.TACK_TELEMETRY_ENDPOINT = "https://telemetry.example.test/ingest";
    setTelemetryPreference(true);
    recordTelemetryCounts({ sessions: 1, briefings_served: 2, notes_logged: 3, decisions_logged: 1 });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(null, { status: 202 });
    }) as typeof globalThis.fetch;

    const sent = await flushTelemetryIfDue();

    expect(sent).toBeTrue();
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://telemetry.example.test/ingest");
    expect((calls[0]!.body as { schema_version: string }).schema_version).toBe("1.0.0");
    expect(typeof (calls[0]!.body as { sent_at: string }).sent_at).toBe("string");
    expect((calls[0]!.body as { counts: Record<string, number> }).counts).toEqual({
      sessions: 1,
      decisions_logged: 1,
      notes_logged: 3,
      briefings_served: 2,
    });

    const config = readTelemetryConfig();
    expect(config.last_sent_at).toBeTruthy();
    expect(config.sent_totals.sessions).toBe(1);
    expect(config.sent_totals.notes_logged).toBe(3);
  });

  it("respects TACK_TELEMETRY=0 as a send override", async () => {
    process.env.TACK_TELEMETRY_ENDPOINT = "https://telemetry.example.test/ingest";
    process.env.TACK_TELEMETRY = "0";
    setTelemetryPreference(true);
    recordTelemetryCounts({ sessions: 1 });

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(null, { status: 202 });
    }) as typeof globalThis.fetch;

    const sent = await flushTelemetryIfDue();

    expect(sent).toBeFalse();
    expect(called).toBeFalse();
  });
});
