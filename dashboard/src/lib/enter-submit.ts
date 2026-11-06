/** Bubble after local React handlers, so suggestions and existing send handlers win. */
export function handleEnterSubmit(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
    || event.isComposing || event.keyCode === 229) return;
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement) || target.closest('[data-enter-newline], [role="combobox"]')) return;
  const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
  if (field && (field.disabled || field.readOnly)) return;
  if (target instanceof HTMLInputElement && !['text', 'email', 'password', 'search', 'url', 'tel', 'number'].includes(target.type)) return;
  const scope = target.closest('[data-enter-submit-scope]');
  if (!field && !(scope && target.isContentEditable)) return;
  const form = field?.form ?? null;
  const scoped = scope && (!form || form.contains(scope));
  const action = scoped
    ? Array.from(scope.querySelectorAll<HTMLButtonElement>('button[data-enter-submit]'))
      .find(button => button.closest('[data-enter-submit-scope]') === scope)
    : form ? Array.from(form.elements).find((element): element is HTMLButtonElement | HTMLInputElement =>
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit') : null;
  if (!action) return;
  event.preventDefault();
  if (event.repeat || action.matches(':disabled') || action.getAttribute('aria-disabled') === 'true'
    || action.closest('[inert], [aria-busy="true"]')) return;
  if (scoped) action.click();
  else form!.requestSubmit(action);
}
