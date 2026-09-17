document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") || "light";
const bridge = window.breadboardFind;
const input = document.querySelector("input");
const count = document.querySelector("#count");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
let timer;
function search(forward, findNext) {
  clearTimeout(timer);
  bridge.search(input.value, forward, findNext);
}
function close() {
  clearTimeout(timer);
  bridge.close();
}
input.addEventListener("input", () => {
  clearTimeout(timer);
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
bridge.onResult(result => { count.textContent = input.value ? `${result?.activeMatchOrdinal ?? 0} / ${result?.matches ?? 0}` : ""; });
bridge.onFocus(() => { input.focus(); input.select(); });
