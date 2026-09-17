import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { gardenBusyRetryDelay } from "../src/lib/pdf-save-retry.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
}

test("PDF saves retry only structured Garden lease conflicts", () => {
  assert.equal(
    gardenBusyRetryDelay(
      {
        code: "GARDEN_MUTATION_BUSY",
        retryable: true,
        retryAfterMs: 2_000,
      },
      409,
    ),
    2_000,
  );
  assert.equal(
    gardenBusyRetryDelay(
      {
        code: "GARDEN_MUTATION_BUSY",
        retryable: true,
        retryAfterMs: 60_000,
      },
      409,
    ),
    30_000,
  );
  assert.equal(
    gardenBusyRetryDelay(
      { code: "GARDEN_MUTATION_BUSY", retryable: true },
      409,
    ),
    2_000,
  );
  assert.equal(gardenBusyRetryDelay({ retryable: true }, 409), null);
  assert.equal(
    gardenBusyRetryDelay(
      { code: "GARDEN_MUTATION_BUSY", retryable: true },
      500,
    ),
    null,
  );
});

test("the PDF background queue schedules Garden lease retries", () => {
  const queue = read("src/lib/pdf-save-client.ts");
  const serverAuth = read("src/lib/server-auth.ts");

  assert.match(queue, /retryAfterMs = gardenBusyRetryDelay/);
  assert.match(queue, /setTimeout\(resolve, retryAfterMs\)/);
  assert.match(serverAuth, /code === 'GARDEN_MUTATION_BUSY'/);
  assert.match(serverAuth, /retryable: true, retryAfterMs: 2_000/);
  assert.match(serverAuth, /'Retry-After': '2'/);
});
