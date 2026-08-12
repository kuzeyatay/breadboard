// ChatMock credential resolution for agent-browser runs. ChatMock authenticates
// the caller locally, so this is a placeholder token unless the environment
// overrides it. Kept server-side; never returned to the browser.

export function chatmockApiKeyValue(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CHATMOCK_API_KEY ?? "").trim() || "local";
}
