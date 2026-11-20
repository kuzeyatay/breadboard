// Settings reads "installed" from a file managed setup leaves behind. If a
// probe drifts from where the executor writes, the row lies (it once said
// every component was installed), so pin each probe to the executor's tables.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  OPTIONAL_COMPONENT_DOWNLOADS,
  OPTIONAL_PYTHON_SERVICES,
} from "../scripts/runtime-v2-managed-setup-executor.mjs";

const source = fs.readFileSync(new URL("../src/lib/runtime-v2/optional-components.ts", import.meta.url), "utf8");
const probes = new Map(
  [...source.matchAll(/id: "([^"]+)",[\s\S]*?probe: "([^"]+)"/g)].map((match) => [match[1], match[2]]),
);

test("every optional component has an install probe the executor writes", () => {
  for (const id of Object.keys(OPTIONAL_PYTHON_SERVICES)) {
    assert.equal(probes.get(id), `runtime-v2/services/${id}/.venv/.breadboard-${id}-ready`, id);
  }
  for (const [id, spec] of Object.entries(OPTIONAL_COMPONENT_DOWNLOADS)) {
    const probe = probes.get(id);
    assert.ok(probe?.startsWith(`${spec.payload}/`), `${id}: ${probe}`);
  }
  assert.equal((source.match(/^\s+id: "/gm) ?? []).length, probes.size, "a component without a probe");
});
