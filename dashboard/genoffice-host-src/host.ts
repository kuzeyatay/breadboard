/**
 * One GenOffice editor session in a plain Node process. The dashboard forks
 * this with advanced serialization and relays the browser iframe's ipcRenderer
 * calls here; the upstream main-process modules run unchanged against the
 * `electron` shim in ./electron-main.ts.
 */
import "./boot";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, invokeMain, webContents, ipcMain, protocolRequest, registeredChannel, resolveRendererRequest, runAccelerator, sendMain, type WebContents } from "./electron-main";
import { registerAiIpc, registerProjectIpc } from "genoffice-upstream/apps/docs/src/main/docs-main";
import { openDocument } from "genoffice-app";
import { setUiLang } from "genoffice-upstream/packages/i18n/src/index.ts";

type Message = { type: string; [key: string]: unknown };
const post = (message: Message) => {
  try { process.send?.(message); }
  catch (error) { process.send?.({ ...message, ok: false, value: undefined, error: `The editor returned data Breadboard cannot carry: ${error instanceof Error ? error.message : error}` }); }
};
let contents: WebContents | null = null;

// Breadboard's model gateway answers the editors' AI as an OpenAI-compatible "custom" provider.
function writeAiSettings(): void {
  const dir = app.getPath("userData"), path = join(dir, "ai-settings.json");
  mkdirSync(dir, { recursive: true });
  const custom = { apiKey: process.env.GENOFFICE_AI_KEY || "breadboard", model: process.env.GENOFFICE_AI_MODEL || "gpt-5.4", baseUrl: process.env.GENOFFICE_AI_BASE_URL || "" };
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(readFileSync(path, "utf8")); } catch { /* first session */ }
  writeFileSync(path, JSON.stringify({ ...stored, provider: custom.baseUrl ? "custom" : "genspark", providers: { ...(stored.providers as object), custom }, gskToolsEnabled: false }, null, 2));
}

/** Calls from a second window (the Slides audience popup) come from that window's webContents. */
const sender = (message: Message) => (message.wc ? webContents.fromId(Number(message.wc)) : undefined) ?? contents!;

process.on("uncaughtException", error => post({ type: "log", level: "error", message: error.stack || String(error) }));
process.on("unhandledRejection", error => post({ type: "log", level: "error", message: error instanceof Error ? error.stack || error.message : String(error) }));
process.on("disconnect", () => process.exit(0));

process.on("message", async (raw) => {
  const message = raw as Message;
  try {
    switch (message.type) {
      case "open": {
        // Upstream defaults to Chinese until the shell sets the language.
        setUiLang("en");
        writeAiSettings();
        registerAiIpc();
        registerProjectIpc();
        contents = await openDocument(message.path as string);
        // The GenOffice shell answers these for every app; Breadboard's frame is the shell here.
        const theme = message.theme === "dark" ? "dark" : "light";
        if (!registeredChannel("app:get-theme")) ipcMain.handle("app:get-theme", () => theme);
        if (!registeredChannel("app:get-language")) ipcMain.handle("app:get-language", () => "en");
        post({ type: "ready" });
        return;
      }
      case "invoke": {
        if (!contents) throw new Error("The editor session has not opened yet.");
        try {
          const value = await invokeMain(sender(message), message.channel as string, message.args as unknown[]);
          post({ type: "result", id: message.id, ok: true, value });
        } catch (error) {
          post({ type: "result", id: message.id, ok: false, error: `Error invoking remote method '${message.channel}': ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}` });
        }
        return;
      }
      case "send": if (contents) sendMain(sender(message), message.channel as string, message.args as unknown[]); return;
      case "window-closed": webContents.fromId(Number(message.wc))?.destroy(); return;
      case "answer": resolveRendererRequest(message.id as number, message.value); return;
      case "menu": runAccelerator(String(message.accelerator)); return;
      case "protocol": post({ type: "protocol-result", id: message.id, ...(await protocolRequest(message.url as string)) }); return;
      case "close": contents?.destroy(); setTimeout(() => process.exit(0), 200); return;
    }
  } catch (error) {
    post({ type: "log", level: "error", message: error instanceof Error ? error.stack || error.message : String(error) });
    if (message.type === "open") post({ type: "failed", error: error instanceof Error ? error.message : String(error) });
  }
});
post({ type: "booted" });
