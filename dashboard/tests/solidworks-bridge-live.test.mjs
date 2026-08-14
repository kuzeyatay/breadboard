// The one test that needs a real machine.
//
// Off by default and off in CI: it starts the SolidworksMCP-python process,
// which connects to SolidWorks and will start it if it is not already open.
// Nothing about that belongs in a test run that is supposed to be free.
//
// Run it deliberately, on Windows, with SolidWorks installed and the clone
// configured:
//
//   BREADBOARD_RUN_SOLIDWORKS_TESTS=1 \
//   BREADBOARD_SOLIDWORKS_MCP_PATH=../SolidworksMCP-python \
//   node --test --experimental-strip-types tests/solidworks-bridge-live.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

const enabled = process.env.BREADBOARD_RUN_SOLIDWORKS_TESTS === "1";

const availability = await import("../src/lib/cad/solidworks/availability.ts");
const { SolidWorksBridge } = await import("../src/lib/cad/solidworks/bridge.ts");
const { buildWithSolidWorks } = await import("../src/lib/cad/solidworks/backend.ts");

test(
  "the real bridge starts, handshakes, and exposes the tools the backend uses",
  { skip: enabled ? false : "set BREADBOARD_RUN_SOLIDWORKS_TESTS=1 to run" },
  async () => {
    const status = await availability.solidworksAvailability();
    assert.equal(status.available, true, status.message);

    // Its own bridge, not the process singleton: this test owns what it starts.
    const bridge = new SolidWorksBridge();
    try {
      const toolCount = await bridge.listTools();
      assert.ok(toolCount > 0, "the MCP server exposed no tools");

      // Attaching to a session that was already open must not claim ownership.
      if (status.running) {
        assert.equal(
          bridge.attachedToExistingSession(),
          true,
          "an already-open SolidWorks must be attached to, not claimed",
        );
      }

      const info = await bridge.callTool("get_model_info", {}, { timeoutMs: 60_000 });
      assert.ok(info, "the bridge answered nothing for get_model_info");
    } finally {
      // The MCP process is ours. SOLIDWORKS.EXE is not, and is left running.
      bridge.shutdown();
    }
  },
);

test(
  "the acceptance part builds, measures, and produces a native SLDPRT",
  { skip: enabled ? false : "set BREADBOARD_RUN_SOLIDWORKS_TESTS=1 to run" },
  async () => {
    const bridge = new SolidWorksBridge();
    try {
      const result = await buildWithSolidWorks({
        bridge,
        source: JSON.stringify({
          name: "breadboard-live-test-plate",
          units: "mm",
          operations: [
            {
              op: "sketch",
              plane: "Front",
              entities: [{ kind: "rectangle", x1: -50, y1: -40, x2: 50, y2: 40 }],
            },
            { op: "extrude", depth: 10 },
            {
              op: "sketch",
              plane: "Front",
              entities: [
                { kind: "circle", centerX: -40, centerY: -30, radius: 2.5 },
                { kind: "circle", centerX: 40, centerY: -30, radius: 2.5 },
                { kind: "circle", centerX: -40, centerY: 30, radius: 2.5 },
                { kind: "circle", centerX: 40, centerY: 30, radius: 2.5 },
              ],
            },
            { op: "cut", depth: 12 },
          ],
        }),
        request: {
          source: "",
          entrypoint: "build_model",
          parameters: {},
          timeoutMs: 120_000,
          exports: [{ format: "glb", filename: "model.glb" }],
          expectations: {},
        },
      });

      assert.equal(result.ok, true, JSON.stringify(result.failure));
      assert.equal(result.engine, "solidworks");
      assert.ok(result.files.sldprt?.byteLength > 0, "no native part was produced");
      assert.ok(result.files.step?.byteLength > 0, "no STEP was produced");
      assert.ok(result.files.glb?.byteLength > 0, "no preview was produced");

      // The measurements are the kernel's, so the plate really is 100 × 80 × 10.
      const box = result.boundingBox;
      assert.ok(box, "the build produced no measured envelope");
      const sorted = [box.x, box.y, box.z].sort((a, b) => b - a);
      assert.ok(Math.abs(sorted[0] - 100) < 0.6, `x was ${sorted[0]}`);
      assert.ok(Math.abs(sorted[1] - 80) < 0.6, `y was ${sorted[1]}`);
      assert.ok(Math.abs(sorted[2] - 10) < 0.6, `z was ${sorted[2]}`);

      // 100 × 80 × 10 less four Ø5 holes through 10 mm.
      const expected = 100 * 80 * 10 - 4 * Math.PI * 2.5 * 2.5 * 10;
      assert.ok(
        Math.abs(result.volume - expected) / expected < 0.02,
        `volume was ${result.volume}, expected about ${expected}`,
      );
    } finally {
      bridge.shutdown();
    }
  },
);
