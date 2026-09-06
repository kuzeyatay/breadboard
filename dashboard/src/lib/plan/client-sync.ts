// Task contents stay in the Plan store. This signal only invalidates other views.
const PLAN_CHANGED = "breadboard:plan-changed";

export function notifyPlanChanged() {
  window.dispatchEvent(new Event(PLAN_CHANGED));
  try {
    localStorage.setItem(PLAN_CHANGED, `${Date.now()}:${Math.random()}`);
  } catch { /* Focus and periodic refresh also work without local storage. */ }
}

export function subscribePlanChanges(refresh: () => void) {
  const visibleRefresh = () => {
    if (document.visibilityState !== "hidden") refresh();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === PLAN_CHANGED) visibleRefresh();
  };
  window.addEventListener(PLAN_CHANGED, visibleRefresh);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", visibleRefresh);
  document.addEventListener("visibilitychange", visibleRefresh);
  const timer = window.setInterval(visibleRefresh, 30_000);
  return () => {
    window.removeEventListener(PLAN_CHANGED, visibleRefresh);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", visibleRefresh);
    document.removeEventListener("visibilitychange", visibleRefresh);
    window.clearInterval(timer);
  };
}
