import React, { useState } from "react";
import { Text, Box, useApp } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { Logo } from "./Logo.js";
import { DetectorSweep } from "./DetectorSweep.js";
import {
  ensureTackIntegrity,
  ensureTackDir,
  ensureContextTemplates,
  specExists,
  writeSpec,
  writeAudit,
  writeDrift,
} from "../lib/files.js";
import { createAudit, createEmptySpec, type Signal, type Spec } from "../lib/signals.js";
import { log } from "../lib/logger.js";
import { ensureTelemetryState, setTelemetryPreference, telemetryPromptNeeded } from "../lib/telemetry.js";

type Phase = "logo" | "check" | "sweep" | "classify" | "add_forbidden" | "project_name" | "telemetry" | "done";

export function Init() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("logo");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [spec, setSpec] = useState<Spec>(createEmptySpec("my-project"));
  const [systemsToClassify, setSystemsToClassify] = useState<Signal[]>([]);
  const [currentSystemIndex, setCurrentSystemIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [forbiddenInput, setForbiddenInput] = useState("");

  React.useEffect(() => {
    if (phase === "logo") {
      setTimeout(() => setPhase("check"), 500);
    }
  }, [phase]);

  React.useEffect(() => {
    if (phase === "check") {
      if (specExists()) {
        const { repaired } = ensureTackIntegrity();
        if (repaired.length > 0) {
          log({ event: "repair", files: repaired });
          // eslint-disable-next-line no-console
          console.log(`\n✓ Repaired .tack integrity (${repaired.length} file(s)): ${repaired.join(", ")}\n`);
        } else {
          // eslint-disable-next-line no-console
          console.log("\n⚠ .tack already initialized. Run 'tack status' instead.\n");
        }
        exit();
        return;
      }
      ensureTackDir();
      ensureContextTemplates();
      ensureTelemetryState();
      setPhase("sweep");
    }
  }, [phase, exit]);

  function handleSweepComplete(detectedSignals: Signal[]) {
    setSignals(detectedSignals);

    const systems = detectedSignals.filter((s) => s.category === "system" || s.category === "scope");
    const unique = new Map<string, Signal>();
    for (const s of systems) {
      if (!unique.has(s.id)) unique.set(s.id, s);
    }

    const toClassify = Array.from(unique.values());
    if (toClassify.length === 0) {
      setPhase("project_name");
    } else {
      setSystemsToClassify(toClassify);
      setCurrentSystemIndex(0);
      setPhase("classify");
    }
  }

  function handleClassify(opt: { value: string }) {
    const current = systemsToClassify[currentSystemIndex]!;

    setSpec((prev) => {
      const next = { ...prev };
      if (opt.value === "allowed") {
        next.allowed_systems = [...prev.allowed_systems, current.id];
      } else if (opt.value === "forbidden") {
        next.forbidden_systems = [...prev.forbidden_systems, current.id];
      }
      return next;
    });

    if (currentSystemIndex + 1 < systemsToClassify.length) {
      setCurrentSystemIndex((i) => i + 1);
    } else {
      setPhase("add_forbidden");
    }
  }

  function handleForbiddenSubmit(value: string) {
    if (value.trim()) {
      const items = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      setSpec((prev) => ({
        ...prev,
        forbidden_systems: [...prev.forbidden_systems, ...items],
      }));
    }
    setPhase("project_name");
  }

  function finalizeInit(finalSpec: Spec) {
    writeSpec(finalSpec);
    writeAudit(createAudit(signals));
    writeDrift({ items: [] });
    log({
      event: "init",
      spec_seeded: true,
      systems_detected: signals.filter((s) => s.category === "system").length,
    });

    setPhase("done");
    setTimeout(() => exit(), 1000);
  }

  function handleProjectName(value: string) {
    const name = value.trim() || "my-project";
    const finalSpec = { ...spec, project: name };
    setSpec(finalSpec);

    if (telemetryPromptNeeded()) {
      setPhase("telemetry");
      return;
    }

    finalizeInit(finalSpec);
  }

  function handleTelemetrySelect(opt: { value: string }) {
    setTelemetryPreference(opt.value === "yes");
    finalizeInit(spec);
  }

  const classifyOptions = [
    { label: "Allowed — I want this", value: "allowed" },
    { label: "Forbidden — I don't want this", value: "forbidden" },
    { label: "Skip — decide later", value: "skip" },
  ];

  const telemetryOptions = [
    { label: "Yes - anonymous counts only", value: "yes" },
    { label: "No - local stats only", value: "no" },
  ];

  return (
    <Box flexDirection="column">
      {(phase === "logo" || phase === "check") && <Logo />}

      {phase === "sweep" && (
        <>
          <Logo />
          <DetectorSweep onComplete={handleSweepComplete} />
        </>
      )}

      {phase === "classify" && systemsToClassify[currentSystemIndex] && (
        <Box flexDirection="column">
          <Text bold>
            Classify detected system ({currentSystemIndex + 1}/{systemsToClassify.length}):
          </Text>
          <Text>
            {"  "}
            <Text color="cyan">{systemsToClassify[currentSystemIndex]!.id}</Text>
            {systemsToClassify[currentSystemIndex]!.detail && (
              <Text dimColor> ({systemsToClassify[currentSystemIndex]!.detail})</Text>
            )}
          </Text>
          <Text dimColor>{"  "}Source: {systemsToClassify[currentSystemIndex]!.source}</Text>
          <Text dimColor>{"  "}Use ↑/↓ to choose, Enter to confirm.</Text>
          <Box marginTop={1}>
            <SelectInput items={classifyOptions} onSelect={handleClassify} />
          </Box>
        </Box>
      )}

      {phase === "add_forbidden" && (
        <Box flexDirection="column">
          <Text>Any systems you want to explicitly forbid? (comma-separated, or Enter to skip)</Text>
          <Text dimColor>e.g.: multi_tenant, admin_panel, background_jobs</Text>
          <Box marginTop={1}>
            <Text>{">"} </Text>
            <TextInput value={forbiddenInput} onChange={setForbiddenInput} onSubmit={handleForbiddenSubmit} />
          </Box>
        </Box>
      )}

      {phase === "project_name" && (
        <Box flexDirection="column">
          <Text>Project name:</Text>
          <Box>
            <Text>{">"} </Text>
            <TextInput
              value={projectName}
              onChange={setProjectName}
              onSubmit={handleProjectName}
              placeholder="my-project"
            />
          </Box>
        </Box>
      )}

      {phase === "telemetry" && (
        <Box flexDirection="column">
          <Text>Share anonymous usage stats to help improve Tack?</Text>
          <Text dimColor>Only counts are shared. No project name, code, decisions, or notes leave the machine.</Text>
          <Box marginTop={1}>
            <SelectInput items={telemetryOptions} onSelect={handleTelemetrySelect} />
          </Box>
        </Box>
      )}

      {phase === "done" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>
            ✓ Initialized /.tack/
          </Text>
          <Text>  spec.yaml — your architecture contract</Text>
          <Text>  _audit.yaml — detector sweep results</Text>
          <Text>  _drift.yaml — drift tracking (empty)</Text>
          <Text>  _logs.ndjson — event log</Text>
          <Text>  context.md/goals.md/assumptions.md/open_questions.md — context templates</Text>
          <Text dimColor>{"\n"}Run "tack status" for a scan or "tack watch" for live monitoring.</Text>
        </Box>
      )}
    </Box>
  );
}
