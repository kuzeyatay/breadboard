import assert from "node:assert/strict";
import test from "node:test";
import {
  savePromptToCatalog,
  suggestedPromptTitle,
} from "../src/lib/hermes/prompt-save-client.ts";

test("a saved chat prompt gets a useful title without its slash command", () => {
  assert.equal(
    suggestedPromptTitle(
      "/agents:agent-tars please open Outlook and summarize the latest email",
    ),
    "please open Outlook and summarize the latest email",
  );
  assert.equal(suggestedPromptTitle("/agents:agent-tars"), "agents:agent-tars");
  assert.equal(suggestedPromptTitle(""), "Saved prompt");
});

test("chat prompts save through the canonical authenticated Prompts endpoint", async () => {
  let request = null;
  const result = await savePromptToCatalog(
    {
      title: "  Latest email summary  ",
      category: "  Custom  ",
      content: "  /agents:agent-tars summarize my latest email  ",
    },
    async (url, init) => {
      request = { url, init };
      return new Response(
        JSON.stringify({
          prompt: {
            id: "user-17",
            title: "Latest email summary",
            category: "Custom",
            content: "/agents:agent-tars summarize my latest email",
          },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
  );

  assert.equal(request.url, "/api/hermes/prompts");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    title: "Latest email summary",
    category: "Custom",
    content: "/agents:agent-tars summarize my latest email",
  });
  assert.equal(result.id, "user-17");
});

test("prompt save failures remain visible to the dialog", async () => {
  await assert.rejects(
    () =>
      savePromptToCatalog(
        { title: "Duplicate", category: "Custom", content: "Prompt body" },
        async () =>
          new Response(JSON.stringify({ message: "The prompt could not be saved." }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    /could not be saved/,
  );
});
