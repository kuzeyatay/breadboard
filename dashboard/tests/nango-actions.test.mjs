import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNangoActionInvocation,
  nangoAction,
  nangoActionsForConnectionSlugs,
} from "../src/lib/nango/actions.ts";

test("featured Nango actions build fixed provider requests with explicit risk", () => {
  const list = buildNangoActionInvocation("gmail_list_messages", {
    query: "newer_than:7d",
    maxResults: 20,
  });
  assert.equal(list.connectionSlug, "gmail");
  assert.equal(list.action.readOnly, true);
  assert.equal(list.request.method, "GET");
  assert.equal(list.request.endpoint, "/gmail/v1/users/me/messages");
  assert.deepEqual(list.request.query, {
    q: "newer_than:7d",
    maxResults: 20,
  });

  const send = buildNangoActionInvocation("gmail_send_message", {
    to: ["reader@example.com"],
    subject: "Test message",
    body: "Hello",
  });
  assert.equal(send.action.risk, "write");
  assert.equal(send.request.method, "POST");
  assert.equal(send.request.endpoint, "/gmail/v1/users/me/messages/send");
  const raw = String(send.request.body.raw);
  assert.match(Buffer.from(raw, "base64url").toString("utf8"), /Test message/);
});

test("read-only actions remain read-only even when their provider uses POST", () => {
  const search = buildNangoActionInvocation("notion_search", {
    query: "planning",
    pageSize: 10,
  });
  assert.equal(search.action.readOnly, true);
  assert.equal(search.request.method, "POST");
  assert.equal(search.request.endpoint, "/v1/search");
});

test("Outlook mail and calendar use separate Breadboard connections", () => {
  assert.equal(
    nangoAction("outlook_send_mail")?.fixedConnectionSlug,
    "microsoft-outlook",
  );
  assert.equal(
    nangoAction("outlook_calendar_create_event")?.fixedConnectionSlug,
    "microsoft-outlook-calendar",
  );
});

test("universal actions separate reads from mutations and reject unsafe paths", () => {
  const read = buildNangoActionInvocation("provider_api_get", {
    connection: "custom-provider",
    endpoint: "/v1/items",
    query: { limit: 5 },
  });
  assert.equal(read.connectionSlug, "custom-provider");
  assert.equal(read.action.readOnly, true);
  assert.equal(read.request.method, "GET");

  const write = buildNangoActionInvocation("provider_api_request", {
    connection: "custom-provider",
    method: "PATCH",
    endpoint: "/v1/items/1",
    body: { enabled: true },
  });
  assert.equal(write.action.readOnly, false);
  assert.equal(write.request.method, "PATCH");

  assert.throws(
    () =>
      buildNangoActionInvocation("provider_api_get", {
        connection: "custom-provider",
        endpoint: "https://attacker.example/items",
      }),
    /endpoint/i,
  );
  assert.throws(
    () =>
      buildNangoActionInvocation("provider_api_request", {
        connection: "custom-provider",
        method: "GET",
        endpoint: "/v1/items",
      }),
    /provider_api_get|must be POST/i,
  );
});

test("action discovery only exposes fixed actions for connected apps", () => {
  const names = new Set(
    nangoActionsForConnectionSlugs(["gmail"]).map((action) => action.name),
  );
  assert.equal(names.has("gmail_get_message"), true);
  assert.equal(names.has("slack_post_message"), false);
  assert.equal(names.has("provider_api_get"), true);
  assert.equal(names.has("provider_api_request"), true);
});
