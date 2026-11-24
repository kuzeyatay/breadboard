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

  // My assets also lists the person's Garden media: the Garden the editor was opened in first, then, further
  // down, every other Garden. A click adds that file to the project (the parent page fetches and imports it).
  let library = [];
  const libraryStyle = `#bb-garden-media{display:grid;gap:6px;margin:10px 0 14px}#bb-garden-media h4{margin:8px 0 2px;font-size:11px;font-weight:600;opacity:.7}
#bb-garden-media button{display:grid;grid-template-columns:22px 1fr;gap:2px 8px;align-items:center;text-align:left;padding:7px 9px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;font:inherit;font-size:12px;cursor:pointer}
#bb-garden-media button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}#bb-garden-media button[disabled]{opacity:.55;cursor:progress}
#bb-garden-media span{grid-row:span 2;font-size:14px;opacity:.75;text-align:center}#bb-garden-media strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#bb-garden-media small{opacity:.6;font-size:11px}`;
  const icon = { video: "▶︎", audio: "♪", image: "▧" };
  function renderLibrary() {
    const tabs = [...document.querySelectorAll(".tabs")].find((el) => el.children.length === 3 && el.children[2].classList.contains("is-active") && el.closest(".panel, aside, section, div"));
    const existing = document.getElementById("bb-garden-media");
    if (!tabs || !library.length) { existing?.remove(); return; }
    if (existing && existing.previousElementSibling === tabs && existing.dataset.count === String(library.length)) return;
    existing?.remove();
    if (!document.getElementById("bb-garden-media-style")) { const style = document.createElement("style"); style.id = "bb-garden-media-style"; style.textContent = libraryStyle; document.head.append(style); }
    const section = document.createElement("section");
    section.id = "bb-garden-media"; section.dataset.count = String(library.length);
    let garden = null;
    library.forEach((item, index) => {
      if (item.garden !== garden) {
        garden = item.garden;
        const heading = document.createElement("h4");
        heading.textContent = index === 0 && item.here ? `In ${item.gardenName}` : item.gardenName;
        section.append(heading);
      }
      const button = document.createElement("button");
      button.type = "button"; button.title = `Add ${item.filename} to this video`;
      const mark = document.createElement("span"); mark.textContent = icon[item.kind] || "▧";
      const name = document.createElement("strong"); name.textContent = item.title;
      const detail = document.createElement("small"); detail.textContent = `${item.kind === "audio" ? "Recording" : item.kind === "image" ? "Image" : "Video"}${item.size ? ` · ${item.size >= 1e9 ? (item.size / 1e9).toFixed(1) + " GB" : Math.max(1, Math.round(item.size / 1e6)) + " MB"}` : ""}`;
      button.append(mark, name, detail);
      button.onclick = () => { button.disabled = true; detail.textContent = "Adding…"; post({ type: "library-pick", url: item.url, filename: item.filename }); };
      section.append(button);
    });
    tabs.after(section);
  }
  new MutationObserver(() => renderLibrary()).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("message", (event) => {
    if (event.source === window.parent && event.data?.source === "breadboard" && event.data.type === "library" && Array.isArray(event.data.items)) {
      library = event.data.items; document.getElementById("bb-garden-media")?.remove(); renderLibrary();
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
