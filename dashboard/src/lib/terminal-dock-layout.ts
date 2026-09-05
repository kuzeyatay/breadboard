// Rest at half the distance from the home dock's top to the viewport bottom.
export const DEFAULT_TERMINAL_DOCK_HEIGHT = 61;

export function terminalDockCollapsedHeight(): number {
  if (typeof document === "undefined") return DEFAULT_TERMINAL_DOCK_HEIGHT;
  const style = getComputedStyle(document.documentElement);
  const dockHeight = Number.parseFloat(style.getPropertyValue("--browser-dock-height"));
  const bottom = Number.parseFloat(style.getPropertyValue("--browser-dock-bottom"));
  return Number.isFinite(dockHeight) && Number.isFinite(bottom)
    ? (dockHeight + bottom) / 2
    : DEFAULT_TERMINAL_DOCK_HEIGHT;
}
