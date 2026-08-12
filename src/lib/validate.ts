import * as path from "node:path";
import type { Audit, DriftItem, DriftState, Signal, Spec, SpecDomain } from "./signals.js";
import { DRIFT_SCHEMA_VERSION, KNOWN_CONSTRAINT_KEYS } from "./signals.js";

const MAX_FIELD_LENGTH = 200;
const MAX_SOURCE_LENGTH = 500;
const SPEC_KEYS = new Set(["project", "allowed_systems", "forbidden_systems", "constraints", "domains"]);
const DRIFT_TYPES = new Set([
  "forbidden_system_detected",
  "constraint_mismatch",
  "risk",
  "undeclared_system",
] as const);
/**
 * Status Tack writes itself when a drift item's underlying signal is no longer detected.
 *
 * It is deliberately not one of the `DriftStatus` values a person can choose: `accepted`
 * and `rejected` are human judgments and suppress the item forever, whereas a disappeared
 * item is only dormant and must reopen if the violation is reintroduced. Keeping the two
 * apart is what stops a removed-then-restored guardrail violation from being suppressed
 * permanently (see engine/computeDrift.ts).
 */
export const DRIFT_STATUS_DISAPPEARED = "disappeared";
const DRIFT_STATUS = new Set(["unresolved", "accepted", "rejected", DRIFT_STATUS_DISAPPEARED] as const);
const DRIFT_ITEM_KEYS = new Set(["id", "type", "system", "risk", "constraint", "signal", "detected", "status", "note"]);
const KNOWN_CONSTRAINTS = new Set<string>(KNOWN_CONSTRAINT_KEYS);

/** True when `item` was auto-dismissed by a sweep rather than resolved by a person. */
export function isDisappearedDriftItem(item: DriftItem): boolean {
  return item.status === DRIFT_STATUS_DISAPPEARED;
}

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

  let domains: Spec["domains"];
  if (raw.domains !== undefined) {
    if (!isRecord(raw.domains)) {
      warnings.push("domains must be an object map and was ignored");
    } else {
      const domainEntries: Record<string, SpecDomain> = {};
      for (const [rawId, rawDomain] of Object.entries(raw.domains)) {
        const id = cleanString(String(rawId), "domains.key", warnings);
        if (!id) {
          warnings.push("Empty domain key after sanitization was skipped");
          continue;
        }
        if (!isRecord(rawDomain)) {
          warnings.push(`Domain "${id}" must be an object and was skipped`);
          continue;
        }

        const domain: SpecDomain = {};

        if (typeof rawDomain.label === "string") {
          const label = cleanString(rawDomain.label, `domains.${id}.label`, warnings);
          if (label) domain.label = label;
        }

        if (rawDomain.systems !== undefined) {
          const systems = sanitizeStringArray(
            rawDomain.systems,
            `domains.${id}.systems`,
            warnings
          );
          if (systems.length > 0) domain.systems = systems;
        }

        if (rawDomain.constraints !== undefined) {
          const rawList = sanitizeStringArray(
            rawDomain.constraints,
            `domains.${id}.constraints`,
            warnings
          );
          const filtered = rawList.filter((c) => {
            if (!KNOWN_CONSTRAINTS.has(c)) {
              warnings.push(
                `Unknown constraint key "${c}" in domains.${id}.constraints ignored`
              );
              return false;
            }
            return true;
          });
          if (filtered.length > 0) domain.constraints = filtered;
        }

        if (Object.keys(domain).length === 0) {
          warnings.push(`Domain "${id}" was empty after sanitization and removed`);
          continue;
        }

        domainEntries[id] = domain;
      }

      if (Object.keys(domainEntries).length > 0) {
        domains = domainEntries;
      }
    }
  }

  return {
    data: {
      project: project || fallbackProject,
      allowed_systems: allowed,
      forbidden_systems: forbidden,
      constraints,
      ...(domains ? { domains } : {}),
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

  // YAML parses an unquoted `detected: 2026-01-01T00:00:00Z` into a Date, so accept
  // that form and serialize it back to ISO rather than silently stamping "now" over
  // the original detection time.
  const rawDetected = raw.detected instanceof Date ? raw.detected.toISOString() : raw.detected;
  const detected =
    typeof rawDetected === "string" && rawDetected.trim()
      ? cleanString(rawDetected, `drift.${raw.id}.detected`, warnings, MAX_SOURCE_LENGTH)
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

/**
 * `lossy` is true when the file held content this validator could not represent —
 * unparseable items, an unknown item type (what a `_drift.yaml` written by a newer Tack
 * looks like to an older one), or root keys beyond `items`. Persisting the validated
 * state back on top of a lossy read would silently delete that content, so callers that
 * write (`readDriftWithError` consumers) must treat `lossy` as a no-persist condition.
 */
/**
 * A short, always-safe description of an arbitrary parsed YAML value for diagnostics.
 * Scalars print their value; anything structured prints only its shape, so cyclic or
 * enormous graphs can never throw or flood a warning.
 */
function describeYamlValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (value instanceof Date) return `date ${value.toISOString()}`;
  const kind = typeof value;
  if (kind === "object") return "object";
  if (kind === "string") {
    const text = value as string;
    return `string "${text.length > 40 ? `${text.slice(0, 40)}...` : text}"`;
  }
  return `${kind} ${String(value)}`;
}

export function validateDriftState(raw: unknown): ValidationResult<DriftState> & { lossy: boolean } {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    if (raw === null || raw === undefined) {
      return { data: { items: [] }, warnings, lossy: false };
    }
    warnings.push("_drift.yaml root must be an object");
    return { data: { items: [] }, warnings, lossy: true };
  }

  const unknownRootKeys = Object.keys(raw).filter((key) => key !== "items" && key !== "schema_version");

  // The version gates a one-time migration, so a value this version cannot vouch for
  // must make the read lossy (read-only), never silently collapse to "unversioned":
  // a hand-edited `schema_version: "2"` would otherwise re-enable the legacy
  // migration, and a future version would be overwritten (downgraded) on rewrite.
  let schemaVersion: number | undefined;
  let versionUnusable = false;
  if (raw.schema_version !== undefined) {
    if (
      typeof raw.schema_version === "number" &&
      Number.isInteger(raw.schema_version) &&
      raw.schema_version >= 1 &&
      raw.schema_version <= DRIFT_SCHEMA_VERSION
    ) {
      schemaVersion = raw.schema_version;
    } else {
      versionUnusable = true;
      // Never serialize the raw value: YAML aliases can make it cyclic
      // (`schema_version: &v {self: *v}`), and JSON.stringify would throw out of
      // validate -> readDriftWithError, aborting the scan instead of treating the
      // file as lossy, read-only state.
      warnings.push(
        `_drift.yaml schema_version (${describeYamlValue(raw.schema_version)}) is not supported by this version of Tack`
      );
    }
  }

  if (!Array.isArray(raw.items)) {
    if (raw.items !== undefined) warnings.push("_drift.yaml items must be an array");
    return {
      data: { ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}), items: [] },
      warnings,
      lossy: raw.items !== undefined || unknownRootKeys.length > 0 || versionUnusable,
    };
  }

  const validated = raw.items.map((item) => validateDriftItem(item, warnings));
  const items = validated.filter((item): item is DriftItem => item !== null);
  const droppedItems = raw.items.length - items.length;
  if (droppedItems > 0) {
    warnings.push(`_drift.yaml: ${droppedItems} item(s) were not recognized by this version of Tack`);
  }
  // A status outside DRIFT_STATUS or a field this version doesn't know (both what a file
  // written by a newer Tack looks like) would be coerced or silently shed on rewrite.
  // Any defined value this validator cannot represent verbatim makes the read lossy:
  // unknown keys, an unusable status, and any known field defined with a non-string
  // value (`detected: null`, `note: {…}`) that validateDriftItem would coerce away.
  // Rewriting on top of those would erase content a newer Tack — or a human — wrote.
  const STRING_FIELDS = ["id", "type", "system", "risk", "constraint", "signal", "detected", "note"] as const;
  /**
   * The validated value a field must equal for the item to round-trip. A YAML-native
   * Date on `detected` is representable as its ISO string; everything else must be a
   * string that survived sanitization byte-for-byte. Comparing values (rather than
   * enumerating coercion rules) catches trimming, control-character stripping and
   * length truncation automatically.
   */
  const roundTripsVerbatim = (rawItem: Record<string, unknown>, item: DriftItem): boolean =>
    STRING_FIELDS.every((field) => {
      const rawValue = rawItem[field];
      if (rawValue === undefined) return true;
      const expected = field === "detected" && rawValue instanceof Date ? rawValue.toISOString() : rawValue;
      return typeof expected === "string" && expected === (item as Record<string, unknown>)[field];
    });

  const hasUnrepresentableContent = raw.items.some((rawItem, index) => {
    if (!isRecord(rawItem)) return false; // Already counted as a dropped item.
    if (Object.keys(rawItem).some((key) => !DRIFT_ITEM_KEYS.has(key))) return true;
    if (
      rawItem.status !== undefined &&
      (typeof rawItem.status !== "string" || !DRIFT_STATUS.has(rawItem.status as DriftItem["status"]))
    ) {
      return true;
    }
    const item = validated[index];
    return item !== null && item !== undefined && !roundTripsVerbatim(rawItem, item);
  });
  return {
    data: { ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}), items },
    warnings,
    lossy: droppedItems > 0 || hasUnrepresentableContent || unknownRootKeys.length > 0 || versionUnusable,
  };
}

