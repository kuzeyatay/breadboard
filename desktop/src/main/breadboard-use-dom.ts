// Fixed page operations shared by the live bridge and Electron QA. Callers
// supply data only; the agent cannot submit JavaScript or arbitrary selectors.
export function breadboardDomOperation(input: {
  action: string; snapshotId: string; ref?: string; text?: string; direction?: string;
  checked?: boolean; offset?: number;
}) {
  const scope = window as unknown as { __bbUse?: { id: string; nodes: Map<string, Element> } };
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
    const controls = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[contenteditable="true"],summary',
    )).filter(visible);
    const elements = controls.slice(offset, offset + 300).map((el, index) => {
      const ref = `e${offset + index + 1}`;
      nodes.set(ref, el);
      const field = el as HTMLInputElement;
      return {
        ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"),
        name: (referencedText(el, "aria-labelledby") || el.getAttribute("aria-label") || labelText(field) ||
          el.getAttribute("placeholder") || el.textContent || el.getAttribute("title") || "").trim().slice(0, 200),
        description: referencedText(el, "aria-describedby").slice(0, 500),
        section: el.closest("section")?.querySelector("h2,h3")?.textContent?.trim().slice(0, 200),
        type: el.getAttribute("type"), disabled: disabled(el),
        focused: document.activeElement === el,
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
    if (changed) el.click();
  } else if (input.action === "click") {
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
      if (!Array.from(el.options).some(option => option.value === input.text && !option.disabled &&
        !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled))) throw new Error("Choose an enabled observed option value.");
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
  return { performed: true, ...(changed !== undefined ? { changed, requestedChecked: input.checked } : {}) };
}
