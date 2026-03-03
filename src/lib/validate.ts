import * as path from "node:path";
import type { Audit, DriftItem, DriftState, Signal, Spec } from "./signals.js";
import { KNOWN_CONSTRAINT_KEYS } from "./signals.js";

const MAX_FIELD_LENGTH = 200;
const MAX_SOURCE_LENGTH = 500;
const SPEC_KEYS = new Set(["project", "allowed_systems", "forbidden_systems", "constraints"]);
const DRIFT_TYPES = new Set([
  "forbidden_system_detected",
  "constraint_mismatch",
  "risk",
  "undeclared_system",
] as const);
const DRIFT_STATUS = new Set(["unresolved", "accepted", "rejected"] as const);
const KNOWN_CONSTRAINTS = new Set<string>(KNOWN_CONSTRAINT_KEYS);

type ValidationResult<T> = {
  data: T;
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(input: string, field: string, warnings: string[], max = MAX_FIELD_LENGTH): string {
  const stripped = input.replace(/[\n\r\t\x00-\x1f]/g, "").trim();
  if (stripped !== input) {
    warnings.push(`Suspicious characters stripped from ${field}`);
  }
  if (stripped.length > max) {
    warnings.push(`Field ${field} exceeded ${max} chars and was truncated`);
    return stripped.slice(0, max);
  }
  return stripped;
}

function sanitizeStringArray(
  value: unknown,
  field: string,
  warnings: string[],
  max = MAX_FIELD_LENGTH
): string[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) warnings.push(`Expected array for ${field}, got ${typeof value}`);
    return [];
  }

  return value
    .flatMap((item): string[] => {
      if (typeof item !== "string") {
        warnings.push(`Non-string value in ${field} skipped`);
        return [];
      }
      const cleaned = cleanString(item, field, warnings, max);
      return cleaned ? [cleaned] : [];
    })
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

export function validateSpec(raw: unknown, projectRoot: string): ValidationResult<Spec | null> {
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    if (raw !== null && raw !== undefined) {
      warnings.push("spec.yaml root must be a mapping/object");
    }
    return { data: null, warnings };
  }

  for (const key of Object.keys(raw)) {
    if (!SPEC_KEYS.has(key)) warnings.push(`Unknown key "${key}" in spec.yaml ignored`);
  }

  const fallbackProject = path.basename(projectRoot);
  const project =
    typeof raw.project === "string"
      ? cleanString(raw.project, "project", warnings)
      : fallbackProject;

  const allowed = sanitizeStringArray(raw.allowed_systems, "allowed_systems", warnings);
  const forbidden = sanitizeStringArray(raw.forbidden_systems, "forbidden_systems", warnings);

  const constraints: Record<string, string> = {};
  if (raw.constraints !== undefined && !isRecord(raw.constraints)) {
    warnings.push("constraints must be an object map and was reset");
  } else if (isRecord(raw.constraints)) {
    for (const [key, value] of Object.entries(raw.constraints)) {
      if (!KNOWN_CONSTRAINTS.has(key)) {
        warnings.push(`Unknown constraint key "${key}" ignored`);
        continue;
      }
      if (typeof value !== "string") {
        warnings.push(`Constraint "${key}" must be a string and was ignored`);
        continue;
      }
      const cleaned = cleanString(value, `constraints.${key}`, warnings);
      if (!cleaned) {
        warnings.push(`Constraint "${key}" was empty after sanitization and removed`);
        continue;
      }
      constraints[key] = cleaned;
    }
  }

  return {
    data: {
      project: project || fallbackProject,
      allowed_systems: allowed,
      forbidden_systems: forbidden,
      constraints,
    },
    warnings,
  };
}

function validateSignal(raw: unknown, bucket: Signal["category"], warnings: string[]): Signal | null {
  if (!isRecord(raw)) {
    warnings.push(`Invalid signal entry in ${bucket} list skipped`);
    return null;
  }
  if (typeof raw.id !== "string" || typeof raw.source !== "string") {
    warnings.push(`Signal in ${bucket} list missing id/source and was skipped`);
    return null;
  }
  if (typeof raw.confidence !== "number" || Number.isNaN(raw.confidence)) {
    warnings.push(`Signal ${raw.id} has invalid confidence and was skipped`);
    return null;
  }
  if (raw.confidence < 0 || raw.confidence > 1) {
    warnings.push(`Signal ${raw.id} confidence was clamped to 0-1`);
  }

  const signal: Signal = {
    category: bucket,
    id: cleanString(raw.id, `signal.${bucket}.id`, warnings),
    source: cleanString(raw.source, `signal.${bucket}.source`, warnings, MAX_SOURCE_LENGTH),
    confidence: Math.max(0, Math.min(1, raw.confidence)),
  };
  if (typeof raw.detail === "string") {
    const detail = cleanString(raw.detail, `signal.${bucket}.detail`, warnings, MAX_SOURCE_LENGTH);
    if (detail) signal.detail = detail;
  }
  if (!signal.id || !signal.source) {
    warnings.push(`Signal in ${bucket} list became empty after sanitization and was skipped`);
    return null;
  }
  return signal;
}

export function validateAudit(raw: unknown): ValidationResult<Audit | null> {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    if (raw !== null && raw !== undefined) warnings.push("_audit.yaml root must be an object");
    return { data: null, warnings };
  }
  if (!isRecord(raw.signals)) {
    warnings.push("_audit.yaml missing signals object");
    return { data: null, warnings };
  }

  const systems = Array.isArray(raw.signals.systems)
    ? raw.signals.systems.map((s) => validateSignal(s, "system", warnings)).filter((s): s is Signal => s !== null)
    : [];
  const scopeSignals = Array.isArray(raw.signals.scope_signals)
    ? raw.signals.scope_signals
        .map((s) => validateSignal(s, "scope", warnings))
        .filter((s): s is Signal => s !== null)
    : [];
  const risks = Array.isArray(raw.signals.risks)
    ? raw.signals.risks.map((s) => validateSignal(s, "risk", warnings)).filter((s): s is Signal => s !== null)
    : [];

  if (!Array.isArray(raw.signals.systems)) warnings.push("_audit.yaml signals.systems was reset");
  if (!Array.isArray(raw.signals.scope_signals)) warnings.push("_audit.yaml signals.scope_signals was reset");
  if (!Array.isArray(raw.signals.risks)) warnings.push("_audit.yaml signals.risks was reset");

  const timestamp =
    typeof raw.timestamp === "string" && raw.timestamp.trim()
      ? cleanString(raw.timestamp, "audit.timestamp", warnings, MAX_SOURCE_LENGTH)
      : new Date().toISOString();

  return {
    data: {
      timestamp,
      signals: {
        systems,
        scope_signals: scopeSignals,
        risks,
      },
    },
    warnings,
  };
}

function validateDriftItem(raw: unknown, warnings: string[]): DriftItem | null {
  if (!isRecord(raw)) {
    warnings.push("Invalid drift item skipped");
    return null;
  }
  if (typeof raw.id !== "string" || typeof raw.signal !== "string") {
    warnings.push("Drift item missing id/signal skipped");
    return null;
  }
  if (typeof raw.type !== "string" || !DRIFT_TYPES.has(raw.type as DriftItem["type"])) {
    warnings.push(`Drift item ${raw.id} has unknown type and was skipped`);
    return null;
  }
  const status =
    typeof raw.status === "string" && DRIFT_STATUS.has(raw.status as DriftItem["status"])
      ? (raw.status as DriftItem["status"])
      : "unresolved";
  if (status !== raw.status) warnings.push(`Drift item ${raw.id} had invalid status and defaulted to unresolved`);

  const detected =
    typeof raw.detected === "string" && raw.detected.trim()
      ? cleanString(raw.detected, `drift.${raw.id}.detected`, warnings, MAX_SOURCE_LENGTH)
      : new Date().toISOString();

  const item: DriftItem = {
    id: cleanString(raw.id, "drift.id", warnings),
    type: raw.type as DriftItem["type"],
    signal: cleanString(raw.signal, "drift.signal", warnings, MAX_SOURCE_LENGTH),
    detected,
    status,
  };

  if (typeof raw.system === "string") item.system = cleanString(raw.system, "drift.system", warnings);
  if (typeof raw.risk === "string") item.risk = cleanString(raw.risk, "drift.risk", warnings);
  if (typeof raw.constraint === "string") {
    item.constraint = cleanString(raw.constraint, "drift.constraint", warnings);
  }
  if (typeof raw.note === "string") item.note = cleanString(raw.note, "drift.note", warnings, MAX_SOURCE_LENGTH);

  if (!item.id || !item.signal) {
    warnings.push("Drift item became empty after sanitization and was skipped");
    return null;
  }
  return item;
}

export function validateDriftState(raw: unknown): ValidationResult<DriftState> {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    if (raw !== null && raw !== undefined) warnings.push("_drift.yaml root must be an object");
    return { data: { items: [] }, warnings };
  }
  if (!Array.isArray(raw.items)) {
    if (raw.items !== undefined) warnings.push("_drift.yaml items must be an array");
    return { data: { items: [] }, warnings };
  }

  const items = raw.items
    .map((item) => validateDriftItem(item, warnings))
    .filter((item): item is DriftItem => item !== null);
  return { data: { items }, warnings };
}

