import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildLifThresholdResetVisual,
  buildMetricTradeoffExplorerVisual,
  buildStdpTimingWindowVisual,
} from "../src/lib/visual-spec.ts";

describe("stable, readable visual ids", () => {
  test("ids read front-to-back from the section number + concept, never tail-sliced", () => {
    const lif = buildLifThresholdResetVisual(
      "learning/2. How Spiking Neural Networks Are Structured/2.1 The Leaky Integrate-and-Fire Neuron",
    );
    assert.equal(lif.id, "vis-2-1-the-leaky-integrate-and-fire-neuron-lif");

    const energy = buildMetricTradeoffExplorerVisual(
      "learning/4. How SNN Performance Is Measured/4.2 Normalized Energy Efficiency",
    );
    assert.equal(energy.id, "vis-4-2-normalized-energy-efficiency-tradeoff");

    // The old bug tail-sliced the slug ("vis-vations-Dense-Computation-...").
    for (const spec of [lif, energy]) {
      assert.ok(spec.id.startsWith("vis-"));
      assert.ok(!/^vis-[a-z]{0,4}-[A-Z]/.test(spec.id), "id must not be a tail-sliced garble");
      assert.ok(spec.id.length <= 80);
      assert.match(spec.id, /^[a-z0-9-]+$/);
    }
  });

  test("ids are deterministic across regenerations", () => {
    const a = buildStdpTimingWindowVisual("learning/3. How SNNs Learn/3.3 Spike-Timing Dependent Plasticity");
    const b = buildStdpTimingWindowVisual("learning/3. How SNNs Learn/3.3 Spike-Timing Dependent Plasticity");
    assert.equal(a.id, b.id);
  });

  test("a page with no number label still yields a readable id", () => {
    const v = buildLifThresholdResetVisual("learning/Topic Overview");
    assert.match(v.id, /^vis-topic-overview-lif$/);
  });
});
