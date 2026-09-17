import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTIONS_UNAVAILABLE,
  readConnectionsPanel,
} from "../src/lib/settings-connections-read.ts";

const URLS = {
  connectionsUrl: "/api/hermes/composio",
  integrationsUrl: "/api/hermes/composio/integrations",
  spotifyUrl: "/api/spotify/connection",
};

/** A reader whose per-URL answers the test dictates, recording what was read. */
function reader(answers) {
  const reads = [];
  return {
    reads,
    read: async (input) => {
      reads.push(input);
      const answer = answers[input];
      if (typeof answer === "function") return answer();
      if (answer === undefined) return { ok: false, body: {} };
      return answer;
    },
  };
}

test("one failing service does not discard the ones that answered", async () => {
  const { read } = reader({
    [URLS.connectionsUrl]: () => {
      throw new Error("composio is down");
    },
    [URLS.integrationsUrl]: {
      ok: true,
      body: { integrations: [{ slug: "gmail" }, { slug: "spotify" }] },
    },
    [URLS.spotifyUrl]: { ok: true, body: { connected: true } },
  });

  const result = await readConnectionsPanel({ read, ...URLS });

  assert.equal(result.failed, true);
  assert.equal(result.message, CONNECTIONS_UNAVAILABLE);
  // The two healthy services still produced their data.
  assert.deepEqual(result.spotify, { connected: true });
  assert.deepEqual(result.integrations, [{ slug: "gmail" }]);
});

test("an unreadable catalog leaves the previous list alone instead of emptying it", async () => {
  const { read } = reader({
    [URLS.connectionsUrl]: { ok: true, body: { provider: "composio" } },
    [URLS.integrationsUrl]: { ok: false, body: { error: "upstream unavailable" } },
    [URLS.spotifyUrl]: { ok: false, body: {} },
  });

  const result = await readConnectionsPanel({ read, ...URLS });

  assert.equal(result.failed, false);
  assert.equal(
    result.integrations,
    undefined,
    "a failed read must not be reported as an empty account list",
  );
  assert.equal(result.spotify, undefined);
});

test("an authenticated account with nothing connected is an empty list", async () => {
  const { read } = reader({
    [URLS.connectionsUrl]: { ok: true, body: { provider: "composio" } },
    [URLS.integrationsUrl]: { ok: true, body: { integrations: [] } },
    [URLS.spotifyUrl]: { ok: true, body: { connected: false } },
  });

  const result = await readConnectionsPanel({ read, ...URLS });
  assert.deepEqual(result.integrations, []);
  assert.deepEqual(result.spotify, { connected: false });
});

test("reading the panel never asks the calendar to synchronize", async () => {
  const { read, reads } = reader({
    [URLS.connectionsUrl]: {
      ok: true,
      body: {
        provider: "composio",
        connectedIntegrations: [{ slug: "google-calendar" }],
      },
    },
    [URLS.integrationsUrl]: { ok: true, body: { integrations: [] } },
    [URLS.spotifyUrl]: { ok: true, body: {} },
  });

  const result = await readConnectionsPanel({ read, ...URLS });

  assert.equal(result.calendarSyncNeeded, false);
  assert.deepEqual(reads.sort(), [
    URLS.connectionsUrl,
    URLS.integrationsUrl,
    URLS.spotifyUrl,
  ].sort());
});

test("a completed authorization is what asks a new calendar to synchronize once", async () => {
  const connected = {
    ok: true,
    body: {
      provider: "composio",
      connectedIntegrations: [{ slug: "google-calendar" }],
    },
  };
  const { read } = reader({
    [URLS.connectionsUrl]: connected,
    [URLS.integrationsUrl]: { ok: true, body: { integrations: [] } },
    [URLS.spotifyUrl]: { ok: true, body: {} },
  });

  const afterAuthorization = await readConnectionsPanel({
    read,
    ...URLS,
    afterAuthorization: true,
  });
  assert.equal(afterAuthorization.calendarSyncNeeded, true);

  // An authorization that connected something else does not drag the calendar in.
  const { read: readOther } = reader({
    [URLS.connectionsUrl]: {
      ok: true,
      body: { provider: "composio", connectedIntegrations: [{ slug: "gmail" }] },
    },
    [URLS.integrationsUrl]: { ok: true, body: { integrations: [] } },
    [URLS.spotifyUrl]: { ok: true, body: {} },
  });
  const other = await readConnectionsPanel({
    read: readOther,
    ...URLS,
    afterAuthorization: true,
  });
  assert.equal(other.calendarSyncNeeded, false);
});

test("the three services are read together, not one after another", async () => {
  let open = 0;
  let concurrent = 0;
  const slow = () =>
    new Promise((resolve) => {
      open += 1;
      concurrent = Math.max(concurrent, open);
      setTimeout(() => {
        open -= 1;
        resolve({ ok: true, body: { provider: "composio", integrations: [] } });
      }, 10);
    });
  await readConnectionsPanel({
    read: slow,
    ...URLS,
  });
  assert.equal(concurrent, 3);
});

test("the service's own message is preferred over the generic failure text", async () => {
  const { read } = reader({
    [URLS.connectionsUrl]: { ok: false, body: { message: "Reconnect your account." } },
    [URLS.integrationsUrl]: { ok: true, body: { integrations: [] } },
    [URLS.spotifyUrl]: { ok: true, body: {} },
  });
  const result = await readConnectionsPanel({ read, ...URLS });
  assert.equal(result.message, "Reconnect your account.");
});
