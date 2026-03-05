import * as yaml from "js-yaml";
import { readSpec, readAudit, readDrift, projectRoot } from "../lib/files.js";
import {
  type DriftItem,
  type DriftState,
  type DecisionEntry,
  type Spec,
  type Audit,
} from "../lib/signals.js";
import { parseContextPack, parseDecisionsMarkdown } from "./contextPack.js";
import { validateAudit, validateDriftState, validateSpec } from "../lib/validate.js";
import {
  getMergeBase,
  getShortRef,
  isGitRepo,
  hasCommits,
  readFileAtRef,
} from "../lib/git.js";

export type ArchSystem = {
  id: string;
  detail?: string;
};

export type ArchSnapshot = {
  ref: string;
  spec: Spec | null;
  systems: ArchSystem[];
  drift: DriftState | null;
  decisions: DecisionEntry[];
  hasSpec: boolean;
  hasAudit: boolean;
  hasDrift: boolean;
};

export type DriftResolutionChange = {
  id: string;
  before: DriftItem | null;
  after: DriftItem | null;
};

export type ArchDiff = {
  baseRef: string;
  headRef: string;
  systems: {
    available: boolean;
    added: ArchSystem[];
    removed: ArchSystem[];
    changed: Array<{ id: string; before: ArchSystem; after: ArchSystem }>;
  };
  drift: {
    available: boolean;
    newlyUnresolved: DriftItem[];
    resolved: DriftResolutionChange[];
  };
  decisions: {
    newDecisions: DecisionEntry[];
  };
  warnings: string[];
};

function buildSystemsFromAudit(audit: Audit | null): ArchSystem[] {
  if (!audit) return [];
  return audit.signals.systems.map((s) => ({
    id: s.id,
    detail: s.detail,
  }));
}

export function computeArchSnapshotFromWorkingTree(): ArchSnapshot {
  const spec = readSpec();
  const audit = readAudit();
  const drift = readDrift();
  const context = parseContextPack();

  return {
    ref: getShortRef(),
    spec,
    systems: buildSystemsFromAudit(audit),
    drift,
    decisions: context.decisions,
    hasSpec: spec !== null,
    hasAudit: audit !== null,
    hasDrift: true,
  };
}

export function computeArchSnapshotFromRef(ref: string): ArchSnapshot {
  let spec: Spec | null = null;
  let hasSpec = false;
  const rawSpec = readFileAtRef(ref, ".tack/spec.yaml");
  if (rawSpec) {
    try {
      const parsed = yaml.load(rawSpec);
      const validated = validateSpec(parsed, projectRoot());
      spec = validated.data;
      hasSpec = spec !== null;
    } catch (err) {
      void err;
      spec = null;
      hasSpec = false;
    }
  }

  let systems: ArchSystem[] = [];
  let hasAudit = false;
  const rawAudit = readFileAtRef(ref, ".tack/_audit.yaml");
  if (rawAudit) {
    try {
      const parsed = yaml.load(rawAudit);
      const validated = validateAudit(parsed);
      systems = buildSystemsFromAudit(validated.data);
      hasAudit = validated.data !== null;
    } catch (err) {
      void err;
      systems = [];
      hasAudit = false;
    }
  }

  let drift: DriftState | null = null;
  let hasDrift = false;
  const rawDrift = readFileAtRef(ref, ".tack/_drift.yaml");
  if (rawDrift) {
    try {
      const parsed = yaml.load(rawDrift);
      const validated = validateDriftState(parsed);
      drift = validated.data;
      hasDrift = true;
    } catch (err) {
      void err;
      drift = null;
      hasDrift = false;
    }
  }

  let decisions: DecisionEntry[] = [];
  const rawDecisions = readFileAtRef(ref, ".tack/decisions.md");
  if (rawDecisions) {
    decisions = parseDecisionsMarkdown(rawDecisions, ".tack/decisions.md");
  }

  return {
    ref,
    spec,
    systems,
    drift,
    decisions,
    hasSpec,
    hasAudit,
    hasDrift,
  };
}

export function computeArchDiff(baseBranch: string): ArchDiff {
  if (!isGitRepo() || !hasCommits()) {
    throw new Error(
      "tack diff requires a git repository with at least one commit.",
    );
  }

  const headRef = "HEAD";
  const mergeBase = getMergeBase(baseBranch, headRef);
  const baseRef = mergeBase ?? baseBranch;

  const headSnapshot = computeArchSnapshotFromWorkingTree();
  const baseSnapshot = computeArchSnapshotFromRef(baseRef);

  const warnings: string[] = [];

  if (!baseSnapshot.spec || !headSnapshot.spec) {
    warnings.push(
      `Missing or invalid .tack/spec.yaml on ${baseRef} or current branch; spec guardrails diff unavailable.`,
    );
  }

  const systemsAvailable = baseSnapshot.hasAudit && headSnapshot.hasAudit;

  const systemsDiff = diffSystems(baseSnapshot.systems, headSnapshot.systems);

  if (!systemsAvailable) {
    warnings.push(
      `Missing .tack/_audit.yaml on ${baseRef} or current branch; systems diff unavailable.`,
    );
  }

  const driftAvailable =
    baseSnapshot.hasDrift && headSnapshot.hasDrift;

  const driftDiff = driftAvailable
    ? diffDrift(baseSnapshot.drift!, headSnapshot.drift!)
    : {
        newlyUnresolved: [] as DriftItem[],
        resolved: [] as DriftResolutionChange[],
      };

  if (!driftAvailable) {
    warnings.push(
      `Missing .tack/_drift.yaml on ${baseRef} or current branch; drift status diff unavailable.`,
    );
  }

  const decisionsDiff = diffDecisions(
    baseSnapshot.decisions,
    headSnapshot.decisions,
  );

  return {
    baseRef,
    headRef: headSnapshot.ref,
    systems: {
      available: systemsAvailable,
      added: systemsDiff.added,
      removed: systemsDiff.removed,
      changed: systemsDiff.changed,
    },
    drift: {
      available: driftAvailable,
      newlyUnresolved: driftDiff.newlyUnresolved,
      resolved: driftDiff.resolved,
    },
    decisions: {
      newDecisions: decisionsDiff,
    },
    warnings,
  };
}

function diffSystems(
  baseSystems: ArchSystem[],
  headSystems: ArchSystem[],
): {
  added: ArchSystem[];
  removed: ArchSystem[];
  changed: Array<{ id: string; before: ArchSystem; after: ArchSystem }>;
} {
  const byId = (systems: ArchSystem[]): Map<string, ArchSystem> => {
    const map = new Map<string, ArchSystem>();
    for (const s of systems) {
      map.set(s.id, s);
    }
    return map;
  };

  const baseMap = byId(baseSystems);
  const headMap = byId(headSystems);

  const added: ArchSystem[] = [];
  const removed: ArchSystem[] = [];
  const changed: Array<{ id: string; before: ArchSystem; after: ArchSystem }> =
    [];

  for (const [id, system] of headMap.entries()) {
    if (!baseMap.has(id)) {
      added.push(system);
    } else {
      const before = baseMap.get(id)!;
      if ((before.detail ?? "") !== (system.detail ?? "")) {
        changed.push({ id, before, after: system });
      }
    }
  }

  for (const [id, system] of baseMap.entries()) {
    if (!headMap.has(id)) {
      removed.push(system);
    }
  }

  return { added, removed, changed };
}

function diffDrift(
  baseDrift: DriftState,
  headDrift: DriftState,
): {
  newlyUnresolved: DriftItem[];
  resolved: DriftResolutionChange[];
} {
  const baseById = new Map<string, DriftItem>();
  for (const item of baseDrift.items) {
    baseById.set(item.id, item);
  }

  const headById = new Map<string, DriftItem>();
  for (const item of headDrift.items) {
    headById.set(item.id, item);
  }

  const newlyUnresolved: DriftItem[] = [];
  const resolved: DriftResolutionChange[] = [];

  for (const item of headDrift.items) {
    if (item.status !== "unresolved") continue;
    const before = baseById.get(item.id);
    if (!before || before.status !== "unresolved") {
      newlyUnresolved.push(item);
    }
  }

  for (const baseItem of baseDrift.items) {
    if (baseItem.status !== "unresolved") continue;
    const current = headById.get(baseItem.id) ?? null;
    if (!current || current.status !== "unresolved") {
      resolved.push({ id: baseItem.id, before: baseItem, after: current });
    }
  }

  return { newlyUnresolved, resolved };
}

function decisionKey(entry: DecisionEntry): string {
  return `${entry.date}:::${entry.decision}:::${entry.reasoning}`;
}

function diffDecisions(
  base: DecisionEntry[],
  head: DecisionEntry[],
): DecisionEntry[] {
  const baseKeys = new Set(base.map(decisionKey));
  return head.filter((entry) => !baseKeys.has(decisionKey(entry)));
}

