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
  let activeSvgTextEditor = null;
  let activeResize = null;

  const htmlResizableTags = new Set([
    "article", "aside", "button", "canvas", "div", "figure", "footer",
    "header", "iframe", "img", "input", "main", "nav", "section", "svg",
    "table", "textarea", "video",
  ]);
  const svgResizableTags = new Set([
    "circle", "ellipse", "foreignobject", "g", "image", "line", "path",
    "polygon", "polyline", "rect", "use",
  ]);

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

  function closeSvgTextEditor(commit) {
    const editor = activeSvgTextEditor;
    if (!editor) return;
    activeSvgTextEditor = null;

    const { input, oldValue, target } = editor;
    const newValue = input.value;
    input.remove();

    if (!commit || newValue === oldValue || !target.isConnected) return;
    target.textContent = newValue;
    Vvveb.Undo.addMutation({
      type: "characterData",
      target,
      oldValue,
      newValue,
    });
    scheduleChange();
  }

  function hideVvvebOutlines() {
    document.getElementById("select-box").style.display = "none";
    document.getElementById("highlight-box").style.display = "none";
  }

  function resizeKind(node) {
    if (!(node instanceof window.FrameWindow.Element)) return null;
    const tagName = node.tagName.toLowerCase();
    if (
      node.namespaceURI === "http://www.w3.org/2000/svg" &&
      svgResizableTags.has(tagName) &&
      !node.closest("defs") &&
      typeof node.getScreenCTM === "function" &&
      typeof node.parentElement?.getScreenCTM === "function"
    ) return "svg";
    return htmlResizableTags.has(tagName) ? "html" : null;
  }

  function configureResizeHandles(node) {
    const selectBox = document.getElementById("select-box");
    const kind = resizeKind(node);
    selectBox.classList.remove("resizable", "breadboard-resize-html", "breadboard-resize-svg");
    if (!kind) return;
    selectBox.classList.add("resizable", `breadboard-resize-${kind}`);
    Vvveb.Builder.resizeMode = "breadboard";
  }

  function pointerInCanvas(event) {
    const frameBounds = Vvveb.Builder.iframe.getBoundingClientRect();
    return {
      x: event.clientX - frameBounds.left,
      y: event.clientY - frameBounds.top,
    };
  }

  function editableDomMatrix(matrix) {
    return new window.FrameWindow.DOMMatrix([
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ]);
  }

  function resizedBounds(resize, point) {
    const deltaX = point.x - resize.startPoint.x;
    const deltaY = point.y - resize.startPoint.y;
    let left = resize.initialBounds.left;
    let right = resize.initialBounds.right;
    let top = resize.initialBounds.top;
    let bottom = resize.initialBounds.bottom;

    if (resize.handle.includes("left")) left += deltaX;
    if (resize.handle.includes("right")) right += deltaX;
    if (resize.handle.includes("top")) top += deltaY;
    if (resize.handle.includes("bottom")) bottom += deltaY;

    const minimumSize = 12;
    if (right - left < minimumSize) {
      if (resize.handle.includes("left")) left = right - minimumSize;
      else right = left + minimumSize;
    }
    if (bottom - top < minimumSize) {
      if (resize.handle.includes("top")) top = bottom - minimumSize;
      else bottom = top + minimumSize;
    }
    return { bottom, height: bottom - top, left, right, top, width: right - left };
  }

  function positionResizeBox(node) {
    const bounds = node.getBoundingClientRect();
    const selectBox = document.getElementById("select-box");
    selectBox.style.left = `${bounds.left}px`;
    selectBox.style.top = `${bounds.top}px`;
    selectBox.style.width = `${bounds.width}px`;
    selectBox.style.height = `${bounds.height}px`;
    selectBox.style.display = "block";
  }

  function updateResize(event) {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId || !resize.node.isConnected) return;
    const bounds = resizedBounds(resize, pointerInCanvas(event));

    if (resize.kind === "html") {
      const computed = window.FrameWindow.getComputedStyle(resize.node);
      if (computed.display === "inline") resize.node.style.display = "inline-block";
      resize.node.style.boxSizing = "border-box";
      if (resize.handle.includes("left") || resize.handle.includes("right")) {
        resize.node.style.width = `${Math.round(bounds.width)}px`;
      }
      if (resize.handle.includes("top") || resize.handle.includes("bottom")) {
        resize.node.style.height = `${Math.round(bounds.height)}px`;
      }
    } else {
      const scaleX = bounds.width / resize.initialBounds.width;
      const scaleY = bounds.height / resize.initialBounds.height;
      const ScreenMatrix = window.FrameWindow.DOMMatrix;
      const screenResize = new ScreenMatrix([
        scaleX,
        0,
        0,
        scaleY,
        bounds.left - scaleX * resize.initialBounds.left,
        bounds.top - scaleY * resize.initialBounds.top,
      ]);
      const matrix = resize.parentScreenMatrix
        .inverse()
        .multiply(screenResize)
        .multiply(resize.initialScreenMatrix);
      const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
        .map((value) => Number(value.toFixed(6)));
      resize.node.setAttribute("transform", `matrix(${values.join(" ")})`);
    }

    resize.changed = true;
    positionResizeBox(resize.node);
    event.preventDefault();
  }

  function finishResize(commit) {
    const resize = activeResize;
    if (!resize) return;
    activeResize = null;
    document.body.classList.remove("breadboard-is-resizing");
    try {
      resize.handleElement.releasePointerCapture(resize.pointerId);
    } catch {
      // The browser releases capture automatically if the pointer left early.
    }

    const attributeName = resize.kind === "svg" ? "transform" : "style";
    if (!commit) {
      if (resize.oldValue == null) resize.node.removeAttribute(attributeName);
      else resize.node.setAttribute(attributeName, resize.oldValue);
    } else if (resize.changed) {
      const newValue = resize.node.getAttribute(attributeName);
      if (newValue !== resize.oldValue) {
        Vvveb.Undo.addMutation({
          type: "attributes",
          target: resize.node,
          attributeName,
          oldValue: resize.oldValue,
          newValue,
        });
        scheduleChange();
      }
    }

    positionResizeBox(resize.node);
    configureResizeHandles(resize.node);
  }

  function startResize(event) {
    const handleElement = event.target.closest("#select-box.resizable .resize > div");
    if (!handleElement || event.button !== 0) return;
    const node = Vvveb.Builder.selectedEl;
    const kind = resizeKind(node);
    if (!kind) return;

    closeSvgTextEditor(true);
    const initialBounds = node.getBoundingClientRect();
    if (!initialBounds.width || !initialBounds.height) return;
    const attributeName = kind === "svg" ? "transform" : "style";

    activeResize = {
      changed: false,
      handle: handleElement.className,
      handleElement,
      initialBounds,
      initialScreenMatrix: kind === "svg" ? editableDomMatrix(node.getScreenCTM()) : null,
      kind,
      node,
      oldValue: node.getAttribute(attributeName),
      parentScreenMatrix: kind === "svg" ? editableDomMatrix(node.parentElement.getScreenCTM()) : null,
      pointerId: event.pointerId,
      startPoint: pointerInCanvas(event),
    };

    document.body.classList.add("breadboard-is-resizing");
    handleElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function enableElementResizing() {
    document.addEventListener("pointerdown", startResize, true);
    document.addEventListener("pointermove", updateResize, true);
    document.addEventListener("pointerup", (event) => {
      if (!activeResize || event.pointerId !== activeResize.pointerId) return;
      finishResize(true);
      event.preventDefault();
    }, true);
    document.addEventListener("pointercancel", () => finishResize(false), true);
    // Stop Vvveb's older mouse-only resizer from running after pointerdown.
    document.addEventListener("mousedown", (event) => {
      if (!event.target.closest("#select-box.resizable .resize > div")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeResize) finishResize(false);
    });
    window.addEventListener("Vvveb.Builder.selectNode", (event) => {
      window.queueMicrotask(() => configureResizeHandles(event.detail.target));
    });
  }

  /**
   * `contenteditable` does not edit SVG <text> nodes in Chromium. Vvveb then
   * resolves the click to the nearest HTML component (usually the containing
   * frame), which makes an SVG-heavy artifact look completely read-only. Put a
   * small HTML input over the clicked label and commit its value back to the
   * SVG node so SVG diagrams use the same undo and autosave path as HTML text.
   */
  function editSvgText(target) {
    if (activeSvgTextEditor?.target === target) {
      activeSvgTextEditor.input.focus();
      activeSvgTextEditor.input.select();
      return;
    }
    closeSvgTextEditor(true);

    // Vvveb cannot size its normal HTML selection box around SVG text and may
    // leave the much larger containing frame outlined. The local input is the
    // editing indicator for this interaction, so remove those stale overlays.
    hideVvvebOutlines();

    const documentNode = window.FrameDocument;
    const bounds = target.getBoundingClientRect();
    const computed = window.FrameWindow.getComputedStyle(target);
    const input = documentNode.createElement("input");
    const oldValue = target.textContent || "";

    input.type = "text";
    input.value = oldValue;
    input.setAttribute("aria-label", "Edit SVG text");
    input.setAttribute("data-vvveb-helpers", "");
    input.setAttribute("data-vvveb-svg-text-editor", "");
    Object.assign(input.style, {
      position: "absolute",
      zIndex: "2147483647",
      boxSizing: "border-box",
      left: `${Math.max(4, bounds.left + window.FrameWindow.scrollX - 6)}px`,
      top: `${Math.max(4, bounds.top + window.FrameWindow.scrollY - 6)}px`,
      width: `${Math.max(120, Math.min(420, bounds.width + 64))}px`,
      height: `${Math.max(30, bounds.height + 12)}px`,
      padding: "4px 7px",
      border: "1px solid #2563eb",
      borderRadius: "4px",
      outline: "none",
      background: "#fff",
      color: computed.fill === "none" ? computed.color : computed.fill,
      fontFamily: computed.fontFamily,
      fontSize: `${Math.max(12, Number.parseFloat(computed.fontSize) || 14)}px`,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      lineHeight: "1.2",
      boxShadow: "0 0 0 2px rgba(37, 99, 235, .14), 0 4px 14px rgba(15, 23, 42, .16)",
    });

    activeSvgTextEditor = { input, oldValue, target };
    documentNode.body.append(input);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeSvgTextEditor(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSvgTextEditor(false);
      }
    });
    ["click", "dblclick", "mousemove", "mouseup"].forEach((eventName) => {
      input.addEventListener(eventName, (event) => event.stopPropagation());
    });
    input.addEventListener("blur", () => closeSvgTextEditor(true), { once: true });
    input.focus();
    input.select();
  }

  function enableSvgTextEditing() {
    const documentNode = window.FrameDocument;
    const helperStyle = documentNode.createElement("style");
    helperStyle.setAttribute("data-vvveb-helpers", "");
    helperStyle.textContent = [
      "svg text, svg tspan {",
      "  pointer-events: all !important;",
      "  cursor: text !important;",
      "}",
    ].join("\n");
    documentNode.head.append(helperStyle);

    const openEditor = (event) => {
      const element = event.target instanceof window.FrameWindow.Element
        ? event.target.closest("svg text, svg tspan")
        : null;
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      editSvgText(element);
    };
    documentNode.addEventListener("click", openEditor, true);
    documentNode.addEventListener("dblclick", openEditor, true);
  }

  function observeDocument() {
    closeSvgTextEditor(false);
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
    Vvveb.TreeList.loadComponents();
    enableSvgTextEditing();
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
    enableElementResizing();

    // The page list is intentionally a single read-only artifact. Start on the
    // useful component palette and leave structure navigation to the tree.
    window.setTimeout(() => document.getElementById("components-tab")?.click(), 0);
    const saveLabel = document.querySelector("#top-panel .save-btn .button-text span");
    if (saveLabel) saveLabel.textContent = "Save now";
  }

  window.BreadboardVvveb = { init };
})();
