import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

const root = path.resolve(import.meta.dirname, "..");

test("chat draft formatting preserves the selection, undo, and send behavior", { timeout: 120_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "format-test.js",
    alias: { "@": path.join(root, "src") },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { useRef, useState } from "react";
      import { createRoot } from "react-dom/client";
      import ChatDraftFormatting from "@/app/components/chat/chat-draft-formatting";
      import { UserMessageText } from "@/app/components/hermes/command-text";
      function Draft({ name, className }) {
        const input = useRef(null);
        const [value, setValue] = useState("");
        const [sent, setSent] = useState("");
        const send = () => { window.sent.push(value); setSent(value); setValue(""); };
        return <form className={className} onSubmit={event => { event.preventDefault(); send(); }}>
          {sent && <section aria-label={name + " transcript"}><UserMessageText content={sent} /></section>}
          <ChatDraftFormatting inputRef={input} value={value} />
          <textarea ref={input} aria-label={name} rows={3} maxLength={120} value={value}
            className="block w-full resize-none px-2 text-sm leading-6"
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send();
            }} />
        </form>;
      }
      window.sent = [];
      createRoot(document.getElementById("root")).render(<>
        <Draft name="Reply" className="fixed left-4 top-4 w-56" />
        <Draft name="Message" className="fixed inset-x-4 bottom-4" />
        <button className="fixed left-4 top-32">Outside</button>
      </>);
    ` },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })])
    .process(readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"]
    .find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.setContent('<html data-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const reply = page.getByRole("textbox", { name: "Reply", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "Format selected text" });
  const bold = toolbar.getByRole("button", { name: "Bold" });
  const selectAll = field => field.press("ControlOrMeta+a");

  await message.fill("garden and circuits");
  await message.dblclick({ position: { x: 22, y: 12 } });
  await expect(toolbar).toBeVisible();
  await bold.click();
  await expect(message).toHaveValue("**garden** and circuits");
  await expect(message).toBeFocused();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await message.press("ControlOrMeta+i");
  await expect(message).toHaveValue("***garden*** and circuits");
  await bold.click();
  await expect(message).toHaveValue("*garden* and circuits");
  await message.press("ControlOrMeta+z");
  await expect(message).toHaveValue("***garden*** and circuits");

  await message.fill("First paragraph\n\nSecond paragraph");
  await selectAll(message);
  await bold.click();
  await expect(message).toHaveValue("**First paragraph**\n\n**Second paragraph**");
  await bold.click();
  await expect(message).toHaveValue("First paragraph\n\nSecond paragraph");

  await message.fill("Circuit\nResistor");
  await selectAll(message);
  await toolbar.getByRole("button", { name: "Text style: Text" }).click();
  const menu = page.getByRole("menu", { name: "Text style", exact: true });
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Text", "Heading 1", "Heading 2", "Heading 3", "Numbered list", "Bulleted list",
  ]);
  assert.ok((await menu.boundingBox()).y < (await toolbar.boundingBox()).y);
  await expect(menu.getByRole("menuitemradio", { name: "Text", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(message).toHaveValue("1. Circuit\n2. Resistor");
  await expect(message).toBeFocused();
  await toolbar.getByRole("button", { name: "Text style: Numbered list" }).click();
  await menu.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(message).toHaveValue("## Circuit\n## Resistor");
  await toolbar.getByRole("button", { name: "Text style: Heading 2" }).click();
  await menu.getByRole("menuitemradio", { name: "Text", exact: true }).click();
  await expect(message).toHaveValue("Circuit\nResistor");
  await message.press("Escape");
  await expect(toolbar).toBeHidden();

  await page.setViewportSize({ width: 320, height: 560 });
  await reply.fill("Read [this]");
  await selectAll(reply);
  await expect(toolbar).toBeVisible();
  await reply.press("Tab");
  await expect(toolbar.getByRole("button", { name: "Link" })).toBeFocused();
  await page.keyboard.press("Enter");
  const url = page.getByRole("textbox", { name: "Link URL" });
  await expect(url).toBeFocused();
  await url.fill("javascript:alert(1)");
  await url.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Enter a valid web URL.");
  await url.fill("https://example.com/Circuit_(film)");
  await url.press("Enter");
  await expect(reply).toHaveValue("[Read \\[this\\]](<https://example.com/Circuit_(film)>)");
  await expect(message).toHaveValue("Circuit\nResistor");
  assert.deepEqual(await page.evaluate(() => window.sent), []);
  await expect(reply).toBeFocused();
  await reply.press("Enter");
  await expect(reply).toHaveValue("");
  assert.deepEqual(await page.evaluate(() => window.sent), ["[Read \\[this\\]](<https://example.com/Circuit_(film)>)"]);
  await expect(page.getByRole("region", { name: "Reply transcript" }).getByRole("link", { name: "Read [this]" }))
    .toHaveAttribute("href", "https://example.com/Circuit_(film)");
  await expect(toolbar).toBeHidden();

  await message.press("ControlOrMeta+a");
  await expect(toolbar).toBeVisible();
  await page.getByRole("button", { name: "Outside" }).click();
  await expect(toolbar).toBeHidden();
});
