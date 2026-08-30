(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const artifactId = params.get("artifactId") || "";
  const parentOrigin = window.location.origin;
  const blankPage = "blank.html";

  let sourceLoading = false;
  let sourceLoaded = false;
  let sourceRequested = false;
  let currentFilename = "page.html";
  let lastEmittedHtml = "";
  let changeTimer = 0;
  let observer = null;

  function post(type, detail) {
    window.parent.postMessage(
      Object.assign({ type, artifactId }, detail || {}),
      parentOrigin,
    );
  }

  function doctype(documentNode) {
    const value = documentNode.doctype;
    if (!value) return "";
    return [
      "<!DOCTYPE ",
      value.name,
      value.publicId ? ` PUBLIC \"${value.publicId}\"` : "",
      !value.publicId && value.systemId ? " SYSTEM" : "",
      value.systemId ? ` \"${value.systemId}\"` : "",
      ">\n",
    ].join("");
  }

  /**
   * Vvveb's stock getHtml removes contenteditable from the live page. That is
   * fine for a manual save, but an autosave would stop a person in the middle
   * of typing. Serialize a clean clone instead so editing remains uninterrupted.
   */
  function htmlSnapshot() {
    const documentNode = window.FrameDocument;
    if (!documentNode || !documentNode.documentElement) return "";

    const root = documentNode.documentElement.cloneNode(true);
    root.removeAttribute("data-vvvebjs-editor");
    root.querySelectorAll("[data-vvveb-helpers]").forEach((node) => node.remove());
    root.querySelectorAll("newsection, vvvebjs-new-section").forEach((node) => node.remove());
    root.querySelectorAll('[src^="chrome-extension://"], [src^="moz-extension://"]').forEach((node) => node.remove());

    root.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("contenteditable");
      node.removeAttribute("spellcheckker");
      Array.from(node.attributes).forEach((attribute) => {
        if (attribute.name.startsWith("data-vvveb-")) {
          node.removeAttribute(attribute.name);
        }
      });
      if (node.classList.contains("vvveb-hidden")) node.classList.remove("vvveb-hidden");
      if (node.classList.contains("is-dragged")) node.classList.remove("is-dragged");
      if (!node.getAttribute("class")) node.removeAttribute("class");
    });

    return `${doctype(documentNode)}${root.outerHTML}`;
  }

  function setSaveButtonState(state) {
    document.querySelectorAll("#top-panel .save-btn").forEach((button) => {
      const loading = button.querySelector(".loading");
      const label = button.querySelector(".button-text");
      if (loading && label) {
        loading.classList.toggle("d-none", state !== "saving");
        label.classList.toggle("d-none", state === "saving");
      }
      if (state === "saved") button.setAttribute("disabled", "true");
      else button.removeAttribute("disabled");
    });
  }

  function emitChange(force) {
    if (!sourceLoaded) return;
    window.clearTimeout(changeTimer);
    changeTimer = 0;
    const html = htmlSnapshot();
    if (!html) return;
    if (!force && html === lastEmittedHtml) return;
    lastEmittedHtml = html;
    setSaveButtonState("dirty");
    post(force ? "breadboard:vvveb-flush" : "breadboard:vvveb-change", { html });
  }

  function scheduleChange() {
    if (!sourceLoaded) return;
    setSaveButtonState("dirty");
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => emitChange(false), 450);
  }

  function observeDocument() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleChange);
    observer.observe(window.FrameDocument.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    window.FrameDocument.addEventListener("input", scheduleChange, true);
    window.FrameDocument.addEventListener("change", scheduleChange, true);
    window.FrameDocument.body.addEventListener("vvveb.undo.add", scheduleChange);
    window.FrameDocument.body.addEventListener("vvveb.undo.restore", scheduleChange);
  }

  function setFilename(filename) {
    currentFilename = filename && /\.html?$/i.test(filename) ? filename : "page.html";
    const page = Vvveb.FileManager.pages.document;
    if (page) {
      page.file = currentFilename;
      page.filename = currentFilename;
      page.title = currentFilename;
    }
    const label = document.querySelector('[data-page="document"] > label span');
    if (label) label.textContent = currentFilename;
  }

  function download() {
    const html = htmlSnapshot();
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = currentFilename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function receive(event) {
    if (
      event.origin !== parentOrigin ||
      event.source !== window.parent ||
      !event.data ||
      event.data.artifactId !== artifactId
    ) return;

    if (event.data.type === "breadboard:vvveb-load") {
      if (typeof event.data.html !== "string" || sourceLoading || sourceLoaded) return;
      sourceRequested = true;
      sourceLoading = true;
      setFilename(event.data.filename);
      Vvveb.Builder.loadHtml(event.data.html);
      return;
    }

    if (event.data.type === "breadboard:vvveb-save-status") {
      setSaveButtonState(event.data.status || "dirty");
    }
  }

  function frameLoaded() {
    if (!sourceRequested) {
      post("breadboard:vvveb-ready");
      return;
    }
    if (!sourceLoading) return;

    sourceLoading = false;
    sourceLoaded = true;
    Vvveb.Undo.reset();
    Vvveb.FileManager.loadComponents();
    Vvveb.TreeList.loadComponents();
    observeDocument();
    lastEmittedHtml = htmlSnapshot();
    setSaveButtonState("saved");
    post("breadboard:vvveb-loaded");
  }

  function init() {
    if (!artifactId) {
      document.body.textContent = "This visual editor link is missing its artifact.";
      return;
    }

    window.addEventListener("message", receive);
    window.addEventListener("Vvveb.iframe.loaded", frameLoaded);

    // Install the Breadboard actions before Gui.init captures action handlers.
    Vvveb.Gui.save = function () {
      emitChange(true);
    };
    Vvveb.Gui.download = download;

    const pages = {
      document: {
        name: "document",
        filename: currentFilename,
        file: currentFilename,
        url: blankPage,
        title: currentFilename,
        folder: null,
        description: "The open Breadboard artifact",
      },
    };

    Vvveb.Builder.init(blankPage);
    Vvveb.Gui.init();
    Vvveb.FileManager.init();
    Vvveb.SectionList.init();
    Vvveb.StyleList.init();
    Vvveb.TreeList.init();
    Vvveb.Breadcrumb.init();
    Vvveb.CssEditor.init();
    Vvveb.FileManager.addPages(pages);
    Vvveb.FileManager.currentPage = "document";
    document.querySelector('[data-page="document"]')?.classList.add("active");
    Vvveb.Gui.toggleRightColumn(null, false);

    // The page list is intentionally a single read-only artifact. Start on the
    // useful component palette and leave structure navigation to the tree.
    window.setTimeout(() => document.getElementById("components-tab")?.click(), 0);
    const saveLabel = document.querySelector("#top-panel .save-btn .button-text span");
    if (saveLabel) saveLabel.textContent = "Save now";
  }

  window.BreadboardVvveb = { init };
})();
