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

export type SpecDomain = {
  label?: string;
  systems?: string[];
  constraints?: string[];
};

export type Spec = {
  project: string;
  allowed_systems: string[];
  forbidden_systems: string[];
  constraints: Record<string, string>;
  domains?: Record<string, SpecDomain>;
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

export type SourceRef =
  | { file: string; line?: number }
  | { derived_from: string[] };

export type DecisionActor = "user" | `agent:${string}`;

export type DecisionEntry = {
  date: string;
  decision: string;
  reasoning: string;
  source: SourceRef;
};

export type AgentNoteType = "tried" | "unfinished" | "discovered" | "blocked" | "warning";

export const AGENT_NOTE_TYPES: AgentNoteType[] = [
  "tried",
  "unfinished",
  "discovered",
  "blocked",
  "warning",
] as const;

export type AgentNote = {
  ts: string;
  type: AgentNoteType;
  message: string;
  related_files?: string[];
  actor: string;
};

export type LogEvent =
  | { ts: string; event: "init"; spec_seeded: boolean; systems_detected: number }
  | { ts: string; event: "repair"; files: string[] }
  | { ts: string; event: "scan"; systems_detected: number; drift_items: number; duration_ms: number }
  | { ts: string; event: "mcp:ready"; transport: "stdio"; agent?: string; agent_type?: string; session_id?: string }
  | { ts: string; event: "mcp:resource"; resource: string; summary?: string; agent?: string; agent_type?: string; session_id?: string }
  | { ts: string; event: "mcp:tool"; tool: string; summary?: string; agent?: string; agent_type?: string; session_id?: string }
  | { ts: string; event: "drift:detected"; system: string; message: string; source: string }
  | { ts: string; event: "drift:resolved"; system: string; message: string; source: string }
  | { ts: string; event: "spec:updated"; field: string; diff: string }
  | { ts: string; event: "decision"; decision: string; reasoning: string; actor: DecisionActor }
  | { ts: string; event: "handoff"; markdown_path: string; json_path: string }
  | { ts: string; event: "compaction:archive_handoffs"; archived_count: number; kept_count: number }
  | { ts: string; event: "note:added"; type: AgentNoteType; actor: string }
  | { ts: string; event: "note:archived"; type: AgentNoteType; actor: string };

type StripTs<T> = T extends { ts: string } ? Omit<T, "ts"> : never;
export type LogEventInput = StripTs<LogEvent>;

export type DetectorResult = {
  name: string;
  signals: Signal[];
};

export type ContextLineRef = {
  file: string;
  line: number;
};

export type ContextBullet = {
  text: string;
  source: ContextLineRef;
};

export type ContextQuestionStatus = "open" | "resolved" | "unknown";

export type ContextQuestion = {
  text: string;
  status: ContextQuestionStatus;
  source: ContextLineRef;
};

export type ImplementationStatus = "implemented" | "pending" | "unknown";

export type ImplementationStatusEntry = {
  key: string;
  status: ImplementationStatus;
  anchors: string[];
  source: ContextLineRef;
};

export type ContextPack = {
  north_star: ContextBullet[];
  current_focus: ContextBullet[];
  goals: ContextBullet[];
  non_goals: ContextBullet[];
  assumptions: ContextQuestion[];
  open_questions: ContextQuestion[];
  implementation_status: ImplementationStatusEntry[];
  decisions: DecisionEntry[];
};

export type HandoffActionItem = {
  text: string;
  source: SourceRef;
};

export type HandoffDetectedSystem = {
  id: string;
  detail?: string;
  confidence: number;
  source: SourceRef;
};

export type HandoffDriftItem = {
  id: string;
  type: DriftItem["type"];
  system?: string;
  risk?: string;
  message: string;
  source: SourceRef;
};

export type HandoffChangedFile = {
  path: string;
  source: SourceRef;
};

export type HandoffAgentNote = AgentNote & {
  source: SourceRef;
};

export type AgentSafety = {
  notice: string;
  generated_by: string;
  source_type: "deterministic";
};

export type AgentGuide = {
  mcp_resources: Array<{ uri: string; description: string }>;
  mcp_tools: Array<{ name: string; description: string }>;
  direct_file_access: {
    read: Array<{ path: string; description: string }>;
    append: Array<{ path: string; format: string }>;
    do_not_modify: string[];
  };
};

export type HandoffReport = {
  schema_version: "1.0.0";
  generated_at: string;
  agent_safety: AgentSafety;
  agent_guide: AgentGuide;
  project: {
    name: string;
    root: string;
    git_ref: string;
    git_branch: string;
  };
  summary: string;
  memory_warnings: string[];
  north_star: ContextBullet[];
  current_focus: ContextBullet[];
  goals: ContextBullet[];
  non_goals: ContextBullet[];
  implementation_status: ImplementationStatusEntry[];
  guardrails: {
    allowed_systems: string[];
    forbidden_systems: string[];
    constraints: Record<string, string>;
    source: SourceRef;
  };
  detected_systems: HandoffDetectedSystem[];
  open_drift_items: HandoffDriftItem[];
  changed_files: HandoffChangedFile[];
  open_questions: ContextQuestion[];
  assumptions: ContextQuestion[];
  recent_decisions: DecisionEntry[];
  verification: {
    steps: string[];
    source: SourceRef;
  };
  next_steps: HandoffActionItem[];
  agent_notes: HandoffAgentNote[];
};

export type ProjectStatusItem = {
  system: string;
  message: string;
};

export type ProjectHealth = "aligned" | "drift";

export type ProjectStatus = {
  name: string;
  health: ProjectHealth;
  driftCount: number;
  driftItems: ProjectStatusItem[];
  lastScan: string | null;
  memoryWarnings: string[];
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
