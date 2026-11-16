import type { ChatAttachment } from "./chat-attachments.ts";

type WorkspaceView = Extract<ChatAttachment, { type: "image" }>;

/** Capture the viewport the question was asked from, before session setup. */
export async function captureWorkspaceView(): Promise<WorkspaceView | null> {
  const url = location.href;
  const isCurrentView = () => document.visibilityState === "visible" && location.href === url;
  if (!isCurrentView()) return null;
  const desktop = (window as Window & {
    breadboardDesktop?: { captureWorkspaceView?: () => Promise<string | null> };
  }).breadboardDesktop;
  try {
    let dataUrl: string | null;
    if (desktop?.captureWorkspaceView) {
      dataUrl = await desktop.captureWorkspaceView();
    } else {
      const viewport = { x: window.scrollX, y: window.scrollY, width: innerWidth, height: innerHeight };
      const { default: render } = await import("html2canvas-pro");
      if (!isCurrentView()) return null;
      const canvas = await render(document.documentElement, {
        ...viewport, scrollX: viewport.x, scrollY: viewport.y,
        scale: Math.min(1, 1920 / Math.max(viewport.width, viewport.height)),
        logging: false, useCORS: true, imageTimeout: 1500,
        ignoreElements: element => element.hasAttribute("data-side-chat-dock") || element.matches('input[type="password"]'),
      });
      try { dataUrl = canvas.toDataURL("image/jpeg", 0.86); }
      finally { canvas.width = canvas.height = 0; }
    }
    if (!isCurrentView() || !dataUrl?.startsWith("data:image/jpeg;base64,")) return null;
    return { type: "image", context: "workspace", name: "Current Breadboard view.jpg", dataUrl };
  } catch {
    return null;
  }
}
