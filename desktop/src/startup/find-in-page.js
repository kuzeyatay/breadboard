import { createFindMissFeedback } from "../../../dashboard/src/lib/find-miss-feedback.ts";

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") || "light";
const bridge = window.breadboardFind;
const input = document.querySelector("input");
const count = document.querySelector("#count");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
let timer;
let lastResultRequestId;
const feedback = createFindMissFeedback();
function search(forward, findNext) {
  clearTimeout(timer);
  feedback.begin(input.value);
  bridge.search(input.value, forward, findNext);
}
function close() {
  clearTimeout(timer);
  feedback.dispose();
  bridge.close();
}
input.addEventListener("input", () => {
  clearTimeout(timer);
  feedback.cancel();
  // The actual search is debounced, but audio must unlock in this gesture.
  if (input.value.trim()) feedback.prepare();
  previous.disabled = next.disabled = !input.value;
  count.textContent = "";
  timer = setTimeout(() => search(true, false), 120);
});
document.querySelector("form").addEventListener("submit", event => {
  event.preventDefault();
  if (input.value) search(true, true);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); close(); }
  else if (event.key === "Enter" && !event.isComposing && (event.target === input || event.shiftKey)) {
    event.preventDefault();
    if (input.value) search(!event.shiftKey, true);
  }
});
previous.addEventListener("click", () => search(false, true));
document.querySelector("#close").addEventListener("click", close);
bridge.onResult(result => {
  if (result?.query !== undefined && result.query !== input.value) return;
  count.textContent = input.value ? `${result?.activeMatchOrdinal ?? 0} / ${result?.matches ?? 0}` : "";
  // State broadcasts repeat results; only a new completed request can buzz.
  if (!result?.finalUpdate || result.requestId === lastResultRequestId) return;
  lastResultRequestId = result.requestId;
  feedback.settle(result.query, result.matches);
});
bridge.onFocus(() => { input.focus(); input.select(); });
window.addEventListener("pagehide", () => feedback.dispose());
