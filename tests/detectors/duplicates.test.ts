import { describe, it, expect } from "bun:test";
import { detectDuplicates } from "../../src/detectors/duplicates.js";
import { createSignal } from "../../src/lib/signals.js";

describe("detectDuplicates", () => {
  it("detects conflicting implementations", () => {
    const signals = [
      createSignal("system", "auth", "a", 0.9, "clerk"),
      createSignal("system", "auth", "b", 0.9, "nextauth"),
    ];
    const result = detectDuplicates(signals);
    expect(result.signals.length).toBe(1);
    expect(result.signals[0]!.category).toBe("risk");
  });

  it("ignores single implementation", () => {
    const signals = [createSignal("system", "auth", "a", 0.9, "clerk")];
    const result = detectDuplicates(signals);
    expect(result.signals.length).toBe(0);
  });

  it("ignores same detail duplicates", () => {
    const signals = [
      createSignal("system", "auth", "a", 0.9, "clerk"),
      createSignal("system", "auth", "b", 0.8, "clerk"),
    ];
    const result = detectDuplicates(signals);
    expect(result.signals.length).toBe(0);
  });
});
