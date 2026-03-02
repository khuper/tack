import { describe, it, expect } from "bun:test";
import { compareSpec } from "../../src/engine/compareSpec.js";
import { createSignal, type Spec } from "../../src/lib/signals.js";

describe("compareSpec", () => {
  it("classifies aligned, forbidden, undeclared", () => {
    const spec: Spec = {
      project: "p",
      allowed_systems: ["framework"],
      forbidden_systems: ["payments"],
      constraints: {},
    };
    const signals = [
      createSignal("system", "framework", "x", 1, "nextjs"),
      createSignal("system", "payments", "x", 1, "stripe"),
      createSignal("system", "auth", "x", 1, "clerk"),
    ];
    const diff = compareSpec(signals, spec);
    expect(diff.aligned.length).toBe(1);
    expect(diff.violations.length).toBe(1);
    expect(diff.undeclared.length).toBe(1);
  });

  it("flags constraint mismatch", () => {
    const spec: Spec = {
      project: "p",
      allowed_systems: ["framework"],
      forbidden_systems: [],
      constraints: { framework: "remix" },
    };
    const diff = compareSpec([createSignal("system", "framework", "x", 1, "nextjs")], spec);
    expect(diff.violations.some((v) => v.type === "constraint_mismatch")).toBeTrue();
  });

  it("computes missing allowed systems", () => {
    const spec: Spec = {
      project: "p",
      allowed_systems: ["auth", "framework"],
      forbidden_systems: [],
      constraints: {},
    };
    const diff = compareSpec([createSignal("system", "framework", "x", 1, "nextjs")], spec);
    expect(diff.missing).toContain("auth");
  });
});
