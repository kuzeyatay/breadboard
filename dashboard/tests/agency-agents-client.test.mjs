import assert from "node:assert/strict";
import test from "node:test";

import { parseAgencyAgentsClientCatalog } from "../src/lib/hermes/agency-agents-client.ts";

test("Agency catalog responses preserve the real roster instead of an initial zero", () => {
  const catalog = parseAgencyAgentsClientCatalog({
    ok: true,
    agents: [
      {
        id: "agency-agent:engineering:frontend",
        slug: "frontend",
        name: "Frontend Developer",
        description: "Builds accessible interfaces.",
        division: "engineering",
        divisionLabel: "Engineering",
        divisionIcon: "Code",
        divisionColor: "#3B82F6",
        services: [],
        source: "Agency Agents",
      },
    ],
    divisions: [
      { slug: "engineering", label: "Engineering", icon: "Code", color: "#3B82F6" },
    ],
    configuration: { status: "ready", message: null },
  });

  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.divisions.length, 1);
  assert.equal(catalog.configuration?.status, "ready");
});

test("Agency HTTP failures are surfaced and never masquerade as an empty roster", () => {
  assert.throws(
    () => parseAgencyAgentsClientCatalog({
      ok: false,
      agents: [],
      divisions: [],
      configuration: {
        status: "missing",
        message: "The Agency Agents catalog could not be found.",
      },
    }, false),
    /catalog could not be found/,
  );
  assert.throws(
    () => parseAgencyAgentsClientCatalog({ error: "Sign in required." }, false),
    /Sign in required/,
  );
  assert.throws(
    () => parseAgencyAgentsClientCatalog({
      ok: true,
      agents: [],
      divisions: [],
      configuration: { status: "ready", message: null },
    }),
    /without a usable roster/,
  );
});
