import test from "node:test";
import assert from "node:assert/strict";

import { quartzTopologyInvestigationRequest } from "../src/lib/quartz-topology-investigation.ts";

test("Quartz Thought Topology investigation handoffs are bounded and Garden-scoped", () => {
  const request = quartzTopologyInvestigationRequest({
    type: "second-brain:assistant-investigate-topology",
    requestId: "topology:request-1",
    clusterSlug: "electromagnetism",
    nodeSlug: "electromagnetism/static-fields",
    label: "Static fields",
    prompt: "Investigate this node through the Thought Topology.",
  });

  assert.deepEqual(request, {
    requestId: "topology:request-1",
    clusterSlug: "electromagnetism",
    nodeSlug: "electromagnetism/static-fields",
    label: "Static fields",
    prompt: "Investigate this node through the Thought Topology.",
  });
});

test("a topology handoff cannot switch Gardens independently of its selected node", () => {
  assert.equal(
    quartzTopologyInvestigationRequest({
      type: "second-brain:assistant-investigate-topology",
      requestId: "topology:request-2",
      clusterSlug: "another-garden",
      nodeSlug: "electromagnetism/static-fields",
      label: "Static fields",
      prompt: "Investigate this node.",
    }),
    null,
  );
  assert.equal(
    quartzTopologyInvestigationRequest({
      type: "second-brain:assistant-investigate-topology",
      requestId: "not valid whitespace",
      clusterSlug: "electromagnetism",
      nodeSlug: "electromagnetism/static-fields",
      label: "Static fields",
      prompt: "Investigate this node.",
    }),
    null,
  );
});
