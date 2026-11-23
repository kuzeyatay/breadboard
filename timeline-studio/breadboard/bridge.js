// Injected before the editor loads. Timeline Studio registers its agent tools with
// document.modelContext.registerTool (WebMCP); Breadboard supplies that API inside the
// frame and relays calls from the parent Video Studio page over postMessage.
(() => {
  if (window.parent === window) return;
  // Inside Breadboard the editor starts in the person's language instead of a first-run picker;
  // it can still be changed in the editor's settings.
  try {
    const key = "ai-voiceover-ui-language";
    if (!localStorage.getItem(key)) {
      const lang = (navigator.language || "en").toLowerCase().split("-")[0];
      localStorage.setItem(key, ["zh", "en", "ja", "ko", "es", "fr", "de", "pt", "th", "vi", "ru", "it", "id"].includes(lang) ? lang : "en");
    }
    // Bread does the editing here, so the editor's first-run tips would only cover it.
    if (!localStorage.getItem("timeline-studio-first-visual-guide-seen-v1")) localStorage.setItem("timeline-studio-first-visual-guide-seen-v1", "1");
  } catch { /* storage blocked: the picker shows, as upstream */ }
  const tools = new Map();
  const post = (message) => window.parent.postMessage({ source: "timeline-studio", ...message }, "*");
  // The editor registers its tools one by one at startup; the parent hears the settled list once.
  let announcing = 0;
  const announce = () => {
    clearTimeout(announcing);
    announcing = setTimeout(() => post({ type: "tools", tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }), 50);
  };
  const modelContext = {
    registerTool(tool, options) {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => { if (tools.get(tool.name) === tool) { tools.delete(tool.name); announce(); } });
      announce();
    },
    unregisterTool(name) { tools.delete(name); announce(); },
  };
  Object.defineProperty(document, "modelContext", { value: modelContext, configurable: true });

  // Media from Breadboard goes through the editor's own import input, as a user's pick would.
  function importFiles(files) {
    const input = [...document.querySelectorAll('input[type="file"][multiple]')].find((el) => /video\/mp4/.test(el.accept));
    if (!input) throw new Error("The editor is not ready to import media yet.");
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, imported: files.map((file) => file.name) };
  }

  const running = new Map();
  window.addEventListener("message", async (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== "breadboard") return;
    if (data.type === "list") return announce();
    if (data.type === "cancel") return running.get(data.id)?.abort();
    if (data.type !== "call") return;
    const controller = new AbortController();
    running.set(data.id, controller);
    try {
      let result;
      if (data.name === "__breadboard_import") result = importFiles(data.files || []);
      else {
        const tool = tools.get(data.name);
        if (!tool) throw new Error(`Timeline Studio has no tool named ${data.name}. Tools: ${[...tools.keys()].join(", ")}`);
        result = await tool.execute(data.args || {}, { signal: controller.signal });
      }
      post({ type: "result", id: data.id, result });
    } catch (error) {
      post({ type: "result", id: data.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      running.delete(data.id);
    }
  });

  // Exports and project saves still download as upstream does; Breadboard also gets a copy.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("blob:")) {
      const name = this.download, href = this.href;
      fetch(href).then((r) => r.blob()).then((blob) => post({ type: "download", filename: name, blob })).catch(() => {});
    }
    return click.call(this);
  };
  post({ type: "ready" });
})();
