export type SignalCategory = "system" | "scope" | "risk";

export type Signal = {
  category: SignalCategory;
  id: string;
  detail?: string;
  source: string;
  confidence: number;
};

export function createSignal(
  category: SignalCategory,
  id: string,
  source: string,
  confidence: number,
  detail?: string
): Signal {
  if (confidence < 0 || confidence > 1) {
    throw new Error(`Signal confidence must be 0-1, got ${confidence}`);
  }
  return { category, id, source, confidence, ...(detail ? { detail } : {}) };
}

export type Spec = {
  project: string;
  allowed_systems: string[];
  forbidden_systems: string[];
  constraints: Record<string, string>;
};

export function createEmptySpec(projectName: string): Spec {
  return {
    project: projectName,
    allowed_systems: [],
    forbidden_systems: [],
    constraints: {},
  };
}

export type Audit = {
  timestamp: string;
  signals: {
    systems: Signal[];
    scope_signals: Signal[];
    risks: Signal[];
  };
};

export function createAudit(signals: Signal[]): Audit {
  return {
    timestamp: new Date().toISOString(),
    signals: {
      systems: signals.filter((s) => s.category === "system"),
      scope_signals: signals.filter((s) => s.category === "scope"),
      risks: signals.filter((s) => s.category === "risk"),
    },
  };
}

export type DriftStatus = "unresolved" | "accepted" | "rejected";

export type DriftItem = {
  id: string;
  type: "forbidden_system_detected" | "constraint_mismatch" | "risk" | "undeclared_system";
  system?: string;
  risk?: string;
  constraint?: string;
  signal: string;
  detected: string;
  status: DriftStatus;
  note?: string;
};

export type DriftState = {
  items: DriftItem[];
};

export function createDriftId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0]!.replace(/-/g, "");
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, "0");
  return `drift-${date}-${seq}`;
}

export type Violation = {
  type: "forbidden_system" | "constraint_mismatch" | "undeclared_system";
  signal: Signal;
  spec_rule: string;
  severity: "error" | "warning";
};

export type SpecDiff = {
  aligned: Signal[];
  violations: Violation[];
  undeclared: Signal[];
  missing: string[];
  risks: Signal[];
};

export type LogEvent =
  | { ts: string; event: "init"; project: string }
  | { ts: string; event: "scan"; systems: number; scope_signals: number; risks: number }
  | { ts: string; event: "drift"; id: string; type: DriftItem["type"]; system?: string; risk?: string }
  | { ts: string; event: "resolve"; id: string; action: string; note?: string }
  | { ts: string; event: "spec_updated"; changes: string };

export type LogEventInput =
  | { event: "init"; project: string }
  | { event: "scan"; systems: number; scope_signals: number; risks: number }
  | { event: "drift"; id: string; type: DriftItem["type"]; system?: string; risk?: string }
  | { event: "resolve"; id: string; action: string; note?: string }
  | { event: "spec_updated"; changes: string };

export type DetectorResult = {
  name: string;
  signals: Signal[];
};

export const KNOWN_SYSTEM_IDS = [
  "auth",
  "db",
  "payments",
  "framework",
  "multi_tenant",
  "admin_panel",
  "background_jobs",
  "exports",
] as const;

export type KnownSystemId = (typeof KNOWN_SYSTEM_IDS)[number];

export const KNOWN_CONSTRAINT_KEYS = [
  "deploy",
  "db",
  "auth",
  "framework",
  "css",
  "hosting",
] as const;
