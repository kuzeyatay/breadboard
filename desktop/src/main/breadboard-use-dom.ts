// Fixed page operations shared by the live bridge and Electron QA. Callers
// supply data only; the agent cannot submit JavaScript or arbitrary selectors.
export function breadboardDomOperation(input: {
  action: string; snapshotId: string; ref?: string; text?: string; direction?: string;
  checked?: boolean; offset?: number;
}) {
  const scope = window as unknown as {
    __bbUse?: { id: string; nodes: Map<string, Element> };
    __bbUseCursor?: { host: HTMLElement; timer: number };
  };
  // A page-local visual cursor. Chromium input is addressed to this page;
  // neither this marker nor its movement touches the Windows mouse pointer.
  // Closed shadow DOM keeps its artwork out of page text and control refs.
  const mark = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return;
    if (scope.__bbUseCursor) {
      clearTimeout(scope.__bbUseCursor.timer);
      scope.__bbUseCursor.host.remove();
    }
    const host = document.createElement("div");
    host.setAttribute("data-breadboard-agent-cursor", "");
    host.setAttribute("aria-hidden", "true");
    host.inert = true;
    host.style.cssText = `all:initial;position:fixed;left:${Math.round((left + right) / 2)}px;top:${Math.round((top + bottom) / 2)}px;width:0;height:0;pointer-events:none;z-index:2147483647;`;
    const shadow = host.attachShadow({ mode: "closed" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    // Cua's default pointer artwork (MIT; see computer-use-overlay/LICENSE.cua.txt), with
    // its native 42px footprint and (55,30) hotspot. The session-name badge
    // is intentionally absent. Keep SVG construction compatible with pages
    // that enforce Trusted Types rather than inserting an HTML string.
    svg.setAttribute("viewBox", "0 0 128 128");
    svg.style.cssText = "position:absolute;left:-18.046875px;top:-9.84375px;display:block;width:42px;height:42px;overflow:visible;pointer-events:none;";
    const shape = "M55 30C48 28 42 33 43 41C43 41 64 98 64 98C67 106 73 106 77 99C77 99 86 79 86 79C88 75 91 72 95 70C95 70 108 63 108 63C115 59 114 53 107 50C107 50 55 30 55 30Z";
    const layer = (fill: string, stroke: string, width: number, opacity = 1) => {
      const arrow = document.createElementNS(svg.namespaceURI, "path");
      for (const [name, value] of Object.entries({ d: shape, fill, stroke, "stroke-width": String(width),
        "stroke-linejoin": "round", "stroke-linecap": "round", opacity: String(opacity) })) arrow.setAttribute(name, value);
      svg.append(arrow);
    };
    for (const [width, opacity] of [[44, .02], [36, .024], [29, .03], [23, .038], [18, .048], [14, .06], [10, .075], [7, .095]] as const) {
      layer("none", "#5ec0e8", width, opacity);
    }
    layer("#5ec0e8", "#fff", 5);
    shadow.append(svg);
    document.documentElement.append(host);
    scope.__bbUseCursor = { host, timer: window.setTimeout(() => {
      host.remove();
      if (scope.__bbUseCursor?.host === host) delete scope.__bbUseCursor;
    }, 2000) };
  };
  // Only the bridge can request these internal operations (not agent input).
  if (input.action === "cursor_hide" || input.action === "cursor_show") {
    if (scope.__bbUseCursor) scope.__bbUseCursor.host.style.visibility = input.action === "cursor_hide" ? "hidden" : "visible";
    return { performed: true };
  }
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && css.visibility !== "hidden" && css.display !== "none";
  };
  const referencedText = (el: Element, attribute: string) =>
    (el.getAttribute(attribute) || "").split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
  const labelText = (field: HTMLInputElement) => Array.from(field.labels ?? []).map(label => {
    const copy = label.cloneNode(true) as Element;
    copy.querySelectorAll("input,textarea,select,button").forEach(control => control.remove());
    return copy.textContent?.trim() || "";
  }).join(" ");
  const disabled = (el: Element) => el.matches(":disabled") ||
    Boolean(el.closest('[aria-disabled="true"], [inert]'));
  const scrollable = (el: Element) => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 &&
    (el === document.scrollingElement || /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY));
  const scrollRegions = () => Array.from(document.querySelectorAll("body *")).filter(el => scrollable(el) && visible(el));
  const visibleArea = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) *
      Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
  };
  const checked = (el: Element): boolean | "mixed" | undefined => {
    if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) {
      return el.indeterminate ? "mixed" : el.checked;
    }
    const value = el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed");
    return value === "mixed" ? "mixed" : value === "true" ? true : value === "false" ? false : undefined;
  };
  if (input.action === "snapshot") {
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Provide a non-negative snapshot offset.");
    const nodes = new Map<string, Element>();
    const controls = Array.from(new Set([
      ...Array.from(document.querySelectorAll(
        'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="textbox"],[role="menuitem"],[role="option"],[role="row"],[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable="false"]),summary',
      )),
      ...scrollRegions(),
    ])).filter(visible);
    const elements = controls.slice(offset, offset + 300).map((el, index) => {
      const ref = `e${offset + index + 1}`;
      nodes.set(ref, el);
      const field = el as HTMLInputElement;
      return {
        ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"),
        name: (referencedText(el, "aria-labelledby") || el.getAttribute("aria-label") || labelText(field) ||
          el.getAttribute("placeholder") || el.textContent?.trim() || el.getAttribute("title") ||
          el.querySelector("[aria-label]")?.getAttribute("aria-label") || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim().slice(0, 200),
        description: referencedText(el, "aria-describedby").slice(0, 500),
        section: el.closest("section")?.querySelector("h2,h3")?.textContent?.trim().slice(0, 200),
        type: el.getAttribute("type"), disabled: disabled(el),
        focused: document.activeElement === el,
        ...(el instanceof HTMLElement && el.isContentEditable ? { editable: true, value: el.innerText.slice(0, 2000) } : {}),
        ...(scrollable(el) ? { scrollable: true, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : {}),
        ...(el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
          (el instanceof HTMLInputElement && !["password", "file", "hidden"].includes(el.type)) ? { value: el.value.slice(0, 2000) } : {}),
        ...(el.hasAttribute("aria-expanded") ? { expanded: el.getAttribute("aria-expanded") } : {}),
        ...(el.hasAttribute("aria-selected") ? { selected: el.getAttribute("aria-selected") } : {}),
        ...(el instanceof HTMLAnchorElement ? { href: el.href } : {}),
        ...(checked(el) !== undefined ? { checked: checked(el) } : {}),
        ...(el instanceof HTMLInputElement && ["range", "number"].includes(el.type)
          ? { min: el.min, max: el.max, step: el.step } : {}),
        ...(el instanceof HTMLSelectElement ? { options: Array.from(el.options).map(o => ({ value: o.value, label: o.label, disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled) })) } : {}),
      };
    });
    scope.__bbUse = { id: input.snapshotId, nodes };
    return { snapshotId: input.snapshotId, text: (document.body?.innerText || "").slice(0, 20000), elements,
      totalElements: controls.length, offset, nextOffset: offset + elements.length < controls.length ? offset + elements.length : null };
  }
  if (input.action === "close_voice") {
    const button = Array.from(document.querySelectorAll('button[aria-label="Close voice mode"]')).find(visible);
    if (!button) return { closed: false };
    (button as HTMLButtonElement).click();
    return { closed: true };
  }
  let el: Element | undefined;
  if (input.ref) {
    if (scope.__bbUse?.id !== input.snapshotId) throw new Error("Snapshot expired. Take another snapshot.");
    el = scope.__bbUse.nodes.get(input.ref);
    if (!el?.isConnected || !visible(el)) throw new Error("Control changed. Take another snapshot.");
    if (disabled(el)) throw new Error("This control is disabled.");
  }
  let changed: boolean | undefined;
  if (input.action === "set_checked") {
    if (!(el instanceof HTMLElement) || typeof input.checked !== "boolean") throw new Error("Choose a switch ref and a boolean checked value.");
    const current = checked(el);
    if (current === undefined) throw new Error("Choose a switch, checkbox, radio, or toggle button from a snapshot.");
    if (el.getAttribute("aria-readonly") === "true" || (el instanceof HTMLInputElement && el.readOnly)) throw new Error("This control is read-only.");
    if (!input.checked && current !== false && ((el instanceof HTMLInputElement && el.type === "radio") || el.getAttribute("role") === "radio")) {
      throw new Error("Select another radio option to turn this one off.");
    }
    changed = current !== input.checked;
    // Use the page's own handler so React state, persistence and side effects
    // match the Profile switch. Repeating an explicit on/off never flips it.
    if (changed) { mark(el); el.click(); }
  } else if (input.action === "click") {
    if (!(el instanceof HTMLElement)) throw new Error("A control ref is required.");
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
    const rect = el.getBoundingClientRect();
    const x = Math.round((Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2);
    const y = Math.round((Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== el && !el.contains(hit))) throw new Error("This control is covered. Take a fresh snapshot and dismiss the covering UI first.");
    mark(el);
    delete scope.__bbUse;
    // Chromium dispatches the full pointer/mouse sequence, including trusted
    // events used by menus and web apps that ignore HTMLElement.click().
    return { mouseTarget: { x, y } };
  } else if (input.action === "fill") {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.readOnly || (el instanceof HTMLInputElement && ["file", "password", "hidden", "checkbox", "radio"].includes(el.type))) {
        throw new Error("This field cannot be filled through Breadboard use.");
      }
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, input.text ?? "");
    } else if (el instanceof HTMLSelectElement) {
      if (!Array.from(el.options).some(option => option.value === input.text && !option.disabled &&
        !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled))) throw new Error("Choose an enabled observed option value.");
      el.value = input.text!;
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      if (el.getAttribute("aria-readonly") === "true") throw new Error("This control is read-only.");
      // Let Chromium deliver a real editing operation. Replacing textContent
      // and dispatching a synthetic Event bypasses Lexical/ProseMirror-style
      // composers and can leave the visible text out of the submitted message.
      el.focus();
      const selection = window.getSelection();
      if (!selection) throw new Error("The editor cannot accept text input.");
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      mark(el);
      delete scope.__bbUse;
      return { requiresTextInsertion: true };
    } else throw new Error("Choose an editable control from a snapshot.");
    mark(el);
    (el as HTMLElement).focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (input.action === "scroll") {
    let target = el;
    while (target && !scrollable(target)) target = target.parentElement ?? undefined;
    if (el && !target) throw new Error("This control has no scrollable panel. Choose a scrollable region from a fresh snapshot.");
    if (!target) {
      const page = document.scrollingElement;
      target = page && scrollable(page) ? page : scrollRegions().sort((a, b) => visibleArea(b) - visibleArea(a))[0];
      if (target && visibleArea(target) === 0) target = undefined;
    }
    if (!target) throw new Error("This page has no visible scrollable region.");
    mark(target);
    const previousScrollTop = target.scrollTop;
    const distance = Math.max(100, target.clientHeight * 0.8);
    const top = input.direction === "top" ? 0 : input.direction === "bottom" ? target.scrollHeight
      : target.scrollTop + (input.direction === "up" ? -distance : distance);
    target.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    delete scope.__bbUse;
    return { performed: true, previousScrollTop, scrollTop: target.scrollTop, moved: target.scrollTop !== previousScrollTop };
  } else if (input.action === "focus") {
    if (!(el instanceof HTMLElement)) throw new Error("A control ref is required.");
    mark(el);
    el.focus();
  } else throw new Error("Unsupported page action.");
  // An action consumes the refs, even when the framework updates asynchronously.
  delete scope.__bbUse;
  return { performed: true, ...(changed !== undefined ? { changed, requestedChecked: input.checked } : {}) };
}
