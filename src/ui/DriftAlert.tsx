import React, { useState } from "react";
import { Text, Box } from "ink";
import SelectInput from "ink-select-input";
import type { DriftItem } from "../lib/signals.js";
import { resolveDriftItem, resolveDriftItemWithSpec } from "../engine/computeDrift.js";
import type { DriftResolutionOutcome } from "../engine/computeDrift.js";
import { CleanupPlan as CleanupPlanView } from "./CleanupPlan.js";
import { log } from "../lib/logger.js";

type Props = {
  item: DriftItem;
  onResolved: () => void;
};

type ViewState = "options" | "cleanup" | "resolved" | "unpersisted";

function failureMessageFor(outcome: DriftResolutionOutcome): string {
  if (outcome.error === "spec_unreadable" || outcome.error === "spec_write_failed") {
    return "NOT saved — .tack/spec.yaml could not be " +
      (outcome.error === "spec_unreadable" ? "read" : "written") +
      "; nothing was changed. Fix spec.yaml, then retry.";
  }
  if (outcome.error === "recovery_pending") {
    return (
      "NOT saved — an earlier resolution did not finish and could not be repaired " +
      "(.tack/_drift.claim.json still present). Fix .tack/spec.yaml and rerun a scan, then retry."
    );
  }
  const driftProblem =
    outcome.error === "drift_write_failed"
      ? ".tack/_drift.yaml could not be written (disk, permissions, or a rejected symlink)"
      : ".tack/_drift.yaml is unreadable";
  return outcome.specUpdated
    ? `Spec updated, but the verdict was NOT saved — ${driftProblem}. Fix it, then retry (retrying is safe).`
    : `NOT saved — ${driftProblem}. Fix it, then retry; nothing was changed.`;
}

export function DriftAlert({ item, onResolved }: Props) {
  const [view, setView] = useState<ViewState>("options");
  const [resolutionLabel, setResolutionLabel] = useState("");
  const [failedAction, setFailedAction] = useState<"accept" | "deny" | null>(null);
  const [failureMessage, setFailureMessage] = useState("");

  const options = [
    { label: "[a] Accept — add to allowed_systems", value: "accept" },
    { label: "[d] Deny — add to forbidden_systems", value: "deny" },
    { label: "[i] Investigate — show referencing files", value: "investigate" },
    { label: "[g] Generate cleanup plan", value: "cleanup" },
    { label: "[s] Skip for now", value: "skip" },
  ];

  function handleSelect(opt: { value: string }) {
    switch (opt.value) {
      case "accept": {
        // The engine performs the whole transaction spec-first: every failure mode
        // either changed nothing or left a recoverable, retry-idempotent partial
        // state that is surfaced verbatim to the user.
        const accepted = resolveDriftItemWithSpec(item, "accepted");
        if (accepted.error === "item_stale") {
          setResolutionLabel("Already resolved or disappeared in a later scan — nothing changed");
          setView("resolved");
          onResolved();
          break;
        }
        if (accepted.error) {
          setFailedAction("accept");
          setFailureMessage(failureMessageFor(accepted));
          setView("unpersisted");
          break;
        }
        log({
          event: "decision",
          decision: `Accepted drift item ${item.id}`,
          reasoning: "Added detected system to allowed_systems from watch flow",
          actor: "user",
        });
        setResolutionLabel("Accepted — spec updated");
        setView("resolved");
        onResolved();
        break;
      }
      case "deny": {
        const denied = resolveDriftItemWithSpec(item, "rejected");
        if (denied.error === "item_stale") {
          setResolutionLabel("Already resolved or disappeared in a later scan — nothing changed");
          setView("resolved");
          onResolved();
          break;
        }
        if (denied.error) {
          setFailedAction("deny");
          setFailureMessage(failureMessageFor(denied));
          setView("unpersisted");
          break;
        }
        log({
          event: "decision",
          decision: `Rejected drift item ${item.id}`,
          reasoning: "Added detected system to forbidden_systems from watch flow",
          actor: "user",
        });
        setResolutionLabel("Denied — spec updated");
        setView("resolved");
        onResolved();
        break;
      }
      case "investigate":
      case "cleanup": {
        setView("cleanup");
        break;
      }
      case "skip": {
        // Skip never changes the stored status (it stays unresolved), so an
        // unpersisted skip loses nothing; the label just stops claiming a save.
        const skipped = resolveDriftItem(item.id, "skipped");
        log({
          event: "decision",
          decision: `Skipped drift item ${item.id}`,
          reasoning: "Deferred action from watch flow",
          actor: "user",
        });
        setResolutionLabel(
          skipped.persisted
            ? "Skipped — will remind on next scan"
            : "Skipped — item stays unresolved (.tack/_drift.yaml is unreadable)"
        );
        setView("resolved");
        onResolved();
        break;
      }
      default:
        break;
    }
  }

  const systemId = item.system ?? item.risk ?? "unknown";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text bold color="yellow">
        ⚠ Drift detected: {systemId}
      </Text>
      <Text>  Source: {item.signal}</Text>
      <Text>  Type: {item.type.replace(/_/g, " ")}</Text>

      {view === "options" && (
        <Box marginTop={1}>
          <SelectInput items={options} onSelect={handleSelect} />
        </Box>
      )}

      {view === "cleanup" && (
        <Box flexDirection="column" marginTop={1}>
          <CleanupPlanView systemId={systemId} />
          <Box marginTop={1}>
            <Text dimColor>Press any key to return to options...</Text>
          </Box>
        </Box>
      )}

      {view === "resolved" && (
        <Box marginTop={1}>
          <Text color="green">✓ {resolutionLabel}</Text>
        </Box>
      )}

      {view === "unpersisted" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">✗ {failureMessage}</Text>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: "[r] Retry now", value: "retry" },
                { label: "[x] Dismiss alert (verdict stays unrecorded)", value: "dismiss" },
              ]}
              onSelect={(opt) => {
                if (opt.value === "retry" && failedAction) {
                  setView("options");
                  handleSelect({ value: failedAction });
                  return;
                }
                setResolutionLabel("Dismissed without saving — the item remains unresolved");
                setView("resolved");
                onResolved();
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
