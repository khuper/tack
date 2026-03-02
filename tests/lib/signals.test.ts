import { describe, it, expect } from "bun:test";
import { createSignal, createDriftId, createEmptySpec } from "../../src/lib/signals.js";

describe("signals", () => {
  it("creates a valid signal", () => {
    const sig = createSignal("system", "framework", "package.json", 0.9, "nextjs");
    expect(sig.id).toBe("framework");
    expect(sig.detail).toBe("nextjs");
  });

  it("throws on confidence outside bounds", () => {
    expect(() => createSignal("system", "auth", "x", -0.1)).toThrow();
    expect(() => createSignal("system", "auth", "x", 1.1)).toThrow();
  });

  it("generates drift IDs with expected prefix", () => {
    const id = createDriftId();
    expect(id.startsWith("drift-")).toBeTrue();
  });

  it("creates empty spec", () => {
    const spec = createEmptySpec("proj");
    expect(spec.project).toBe("proj");
    expect(spec.allowed_systems).toEqual([]);
  });
});
