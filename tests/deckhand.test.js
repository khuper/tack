import test from "node:test";
import assert from "node:assert";
import {
  DECKHAND_MAX_WIDTH,
  DECKHAND_MIN_WIDTH,
  clampDeckhandWidth,
  deckhandModeAt,
  renderDeckhandFrame,
} from "../dist/lib/deckhand.js";

const MODES = ["idle", "scan", "mcp"];

function rowText(runs) {
  return runs.map((run) => run.text).join("");
}

function frameText(frame) {
  return frame.rows.map(rowText);
}

test("every frame is exactly the requested width on every row, in every mode", () => {
  for (const width of [DECKHAND_MIN_WIDTH, 52, 63, DECKHAND_MAX_WIDTH]) {
    for (const mode of MODES) {
      for (const crates of [0, 1, 4, 9]) {
        for (const drift of [false, true]) {
          for (let frame = 0; frame < 120; frame += 7) {
            const rendered = renderDeckhandFrame({ mode, crates, drift, animate: true }, frame, width);
            assert.strictEqual(rendered.width, width);
            assert.strictEqual(rendered.rows.length, 5);
            for (const row of rendered.rows) {
              const text = rowText(row);
              assert.strictEqual([...text].length, width, `${mode} w=${width} f=${frame}: ${JSON.stringify(text)}`);
              assert.ok(!/[\r\n\t]/.test(text), "rows never contain control characters");
              for (const run of row) {
                assert.ok(run.text.length > 0 && run.text.length <= 64, "runs stay short enough for cheap reconciliation");
              }
            }
          }
        }
      }
    }
  }
});

test("width is clamped to the supported range with a margin for the terminal", () => {
  assert.strictEqual(clampDeckhandWidth(undefined), DECKHAND_MAX_WIDTH);
  assert.strictEqual(clampDeckhandWidth(20), DECKHAND_MIN_WIDTH);
  assert.strictEqual(clampDeckhandWidth(60), 56);
  assert.strictEqual(clampDeckhandWidth(500), DECKHAND_MAX_WIDTH);
  assert.strictEqual(renderDeckhandFrame({ mode: "idle", crates: 0, drift: false, animate: true }, 0, 10).width, DECKHAND_MIN_WIDTH);
});

test("frames are deterministic and a still frame ignores the frame counter", () => {
  const a = renderDeckhandFrame({ mode: "mcp", crates: 3, drift: true, animate: true }, 17, 64);
  const b = renderDeckhandFrame({ mode: "mcp", crates: 3, drift: true, animate: true }, 17, 64);
  assert.deepStrictEqual(a, b);

  const still0 = renderDeckhandFrame({ mode: "scan", crates: 2, drift: false, animate: false }, 0, 64);
  const still9 = renderDeckhandFrame({ mode: "scan", crates: 2, drift: false, animate: false }, 9, 64);
  assert.deepStrictEqual(still0, still9);
  assert.strictEqual(still0.caption, "on standby");
});

test("the deckhand actually moves while scanning and delivering, and stands still when idle", () => {
  const positions = (mode) =>
    new Set(
      Array.from({ length: 80 }, (_, frame) => {
        const [, , body] = frameText(renderDeckhandFrame({ mode, crates: 0, drift: false, animate: true }, frame, 64));
        return body.indexOf("●");
      })
    );
  assert.ok(positions("scan").size > 10, "scanning walks the deck");
  assert.ok(positions("mcp").size > 10, "hauling walks the deck");
  assert.strictEqual(positions("idle").size, 1, "idle stands in place");
});

test("the delivery loop carries a crate out and comes back empty-handed", () => {
  let carried = 0;
  let empty = 0;
  for (let frame = 0; frame < 80; frame += 1) {
    const [, , body] = frameText(renderDeckhandFrame({ mode: "mcp", crates: 0, drift: false, animate: true }, frame, 64));
    const head = body.indexOf("●");
    const nextTo = body[head + 1] === "▣" || body[head - 1] === "▣";
    if (nextTo) carried += 1;
    else empty += 1;
  }
  assert.ok(carried > 20 && empty > 20, `carried=${carried} empty=${empty}`);
});

test("crates stack on the dock, the count is labelled, and drift flags the front crate", () => {
  const four = renderDeckhandFrame({ mode: "idle", crates: 4, drift: false, animate: true }, 0, 64);
  const [status, , body, deck] = frameText(four);
  assert.ok(status.includes("▣ 4 crates docked"), status);
  assert.strictEqual((deck.match(/▣/g) ?? []).length, 3, "three crates fit on the lower row");
  assert.strictEqual((body.match(/▣/g) ?? []).length, 1, "the fourth stacks on top");
  assert.ok(!status.includes("▲"));

  const flagged = renderDeckhandFrame({ mode: "idle", crates: 2, drift: true, animate: true }, 0, DECKHAND_MAX_WIDTH);
  const [flaggedStatus, , flaggedBody] = frameText(flagged);
  assert.ok(flaggedStatus.includes("▲ drift"));
  assert.ok(flaggedBody.includes("▲"), "a marker sits above the flagged crate");
  const flagRun = flagged.rows[3].find((run) => run.text.includes("▣") && run.color === "#f87171");
  assert.ok(flagRun, "the flagged crate is red");

  const empty = renderDeckhandFrame({ mode: "idle", crates: 0, drift: false, animate: true }, 0, 64);
  assert.ok(frameText(empty)[0].includes("▣ hold empty"));
  assert.strictEqual(empty.caption, "deck quiet, waiting for agents");
});

test("narrow terminals get compact labels and an ellipsized caption rather than a collision", () => {
  const narrow = renderDeckhandFrame({ mode: "mcp", crates: 12, drift: true, animate: true }, 5, DECKHAND_MIN_WIDTH);
  const [status] = frameText(narrow);
  assert.ok(status.endsWith("▣ 12  ▲"), status);
  assert.ok(status.includes("…"), "the caption is clipped with an ellipsis");
  assert.ok(!status.includes("docked"));

  const wide = renderDeckhandFrame({ mode: "scan", crates: 12, drift: true, animate: true }, 5, DECKHAND_MAX_WIDTH);
  const [wideStatus] = frameText(wide);
  assert.ok(wideStatus.includes("inspecting flagged cargo"));
  assert.ok(wideStatus.endsWith("▣ 12 crates docked  ▲ drift"), wideStatus);

  // The longest caption plus a flag does not fit even at full width; the caption wins
  // and the labels go compact rather than colliding.
  const longest = renderDeckhandFrame({ mode: "mcp", crates: 12, drift: true, animate: true }, 5, DECKHAND_MAX_WIDTH);
  const [longestStatus] = frameText(longest);
  assert.ok(longestStatus.includes("hauling agent memory past flagged cargo"));
  assert.ok(longestStatus.endsWith("▣ 12  ▲"), longestStatus);
});

test("mode follows recent activity and settles back to idle", () => {
  const now = 1_000_000;
  assert.strictEqual(deckhandModeAt(now, null, null), "idle");
  assert.strictEqual(deckhandModeAt(now, now - 1_000, now - 500), "mcp", "agent activity outranks a scan");
  assert.strictEqual(deckhandModeAt(now, now - 10_000, now - 1_000), "scan");
  assert.strictEqual(deckhandModeAt(now, now - 10_000, now - 10_000), "idle");
});
