// Fixed page operations shared by the live bridge and Electron QA. Callers
// supply data only; the agent cannot submit JavaScript or arbitrary selectors.
export function breadboardDomOperation(input: {
  action: string; snapshotId: string; ref?: string; text?: string; direction?: string;
}) {
  const scope = window as unknown as { __bbUse?: { id: string; nodes: Map<string, Element> } };
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && css.visibility !== "hidden" && css.display !== "none";
  };
  if (input.action === "snapshot") {
    const nodes = new Map<string, Element>();
    const elements = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,[role="button"],[role="tab"],[role="checkbox"],[contenteditable="true"],summary',
    )).filter(visible).slice(0, 300).map((el, index) => {
      const ref = `e${index + 1}`;
      nodes.set(ref, el);
      const field = el as HTMLInputElement;
      return {
        ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"),
        name: (el.getAttribute("aria-label") || field.labels?.[0]?.textContent ||
          el.getAttribute("placeholder") || el.textContent || el.getAttribute("title") || "").trim().slice(0, 200),
        type: el.getAttribute("type"), disabled: field.disabled === true,
        focused: document.activeElement === el,
        ...(el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
          (el instanceof HTMLInputElement && !["password", "file", "hidden"].includes(el.type)) ? { value: el.value.slice(0, 2000) } : {}),
        ...(el.hasAttribute("aria-expanded") ? { expanded: el.getAttribute("aria-expanded") } : {}),
        ...(el.hasAttribute("aria-selected") ? { selected: el.getAttribute("aria-selected") } : {}),
        ...(el instanceof HTMLAnchorElement ? { href: el.href } : {}),
        ...(el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) ? { checked: el.checked } : {}),
        ...(el instanceof HTMLSelectElement ? { options: Array.from(el.options).map(o => ({ value: o.value, label: o.label })) } : {}),
      };
    });
    scope.__bbUse = { id: input.snapshotId, nodes };
    return { snapshotId: input.snapshotId, text: (document.body?.innerText || "").slice(0, 20000), elements };
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
    if ((el as HTMLInputElement).disabled) throw new Error("This control is disabled.");
  }
  if (input.action === "click") {
    if (!(el instanceof HTMLElement)) throw new Error("A control ref is required.");
    el.click();
  } else if (input.action === "fill") {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.readOnly || (el instanceof HTMLInputElement && ["file", "password", "hidden", "checkbox", "radio"].includes(el.type))) {
        throw new Error("This field cannot be filled through Breadboard use.");
      }
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, input.text ?? "");
    } else if (el instanceof HTMLSelectElement) {
      if (!Array.from(el.options).some(option => option.value === input.text)) throw new Error("Choose an observed option value.");
      el.value = input.text!;
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      el.textContent = input.text ?? "";
    } else throw new Error("Choose an editable control from a snapshot.");
    (el as HTMLElement).focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (input.action === "scroll") {
    const target = el ?? document.scrollingElement;
    if (!target) throw new Error("This page cannot scroll.");
    const distance = Math.max(100, target.clientHeight * 0.8);
    const top = input.direction === "top" ? 0 : input.direction === "bottom" ? target.scrollHeight
      : target.scrollTop + (input.direction === "up" ? -distance : distance);
    target.scrollTo({ top, behavior: "instant" as ScrollBehavior });
  } else if (input.action === "focus") {
    if (!(el instanceof HTMLElement)) throw new Error("A control ref is required.");
    el.focus();
  } else throw new Error("Unsupported page action.");
  // An action consumes the refs, even when the framework updates asynchronously.
  delete scope.__bbUse;
  return { performed: true };
}
