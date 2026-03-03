import React, { useState } from "react";
import { Text, Box } from "ink";
import SelectInput from "ink-select-input";
import type { DriftItem } from "../lib/signals.js";
import { resolveDriftItem } from "../engine/computeDrift.js";
import { readSpec, writeSpec } from "../lib/files.js";
import { CleanupPlan as CleanupPlanView } from "./CleanupPlan.js";
import { log } from "../lib/logger.js";

type Props = {
  item: DriftItem;
  onResolved: () => void;
};

type ViewState = "options" | "cleanup" | "resolved";

export function DriftAlert({ item, onResolved }: Props) {
  const [view, setView] = useState<ViewState>("options");
  const [resolutionLabel, setResolutionLabel] = useState("");

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
        const spec = readSpec();
        if (spec && item.system) {
          let changed = false;
          if (!spec.allowed_systems.includes(item.system)) {
            spec.allowed_systems.push(item.system);
            changed = true;
          }
          spec.forbidden_systems = spec.forbidden_systems.filter((s) => s !== item.system);
          if (changed) {
            log({
              event: "spec:updated",
              field: "allowed_systems",
              diff: `added ${item.system}`,
            });
          }
          writeSpec(spec);
        }
        resolveDriftItem(item.id, "accepted", "Accepted via tack watch");
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
        const spec = readSpec();
        if (spec && item.system) {
          let changed = false;
          if (!spec.forbidden_systems.includes(item.system)) {
            spec.forbidden_systems.push(item.system);
            changed = true;
          }
          spec.allowed_systems = spec.allowed_systems.filter((s) => s !== item.system);
          if (changed) {
            log({
              event: "spec:updated",
              field: "forbidden_systems",
              diff: `added ${item.system}`,
            });
          }
          writeSpec(spec);
        }
        resolveDriftItem(item.id, "rejected", "Rejected via tack watch");
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
        resolveDriftItem(item.id, "skipped");
        log({
          event: "decision",
          decision: `Skipped drift item ${item.id}`,
          reasoning: "Deferred action from watch flow",
          actor: "user",
        });
        setResolutionLabel("Skipped — will remind on next scan");
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
    </Box>
  );
}
