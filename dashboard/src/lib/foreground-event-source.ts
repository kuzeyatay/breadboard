import { desktopTabsBridge, type DesktopTabsState } from "./desktop-browser-tabs.ts";

/** UI-only updates must not reserve an HTTP connection in every hidden tab. */
export class ForegroundEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private stream: EventSource | null = null;
  private disposed = false;
  private detach: (() => void) | undefined;
  private desktopState: DesktopTabsState | undefined;
  private readonly bridge = desktopTabsBridge();

  constructor(private readonly url: string, private active = true) {
    document.addEventListener("visibilitychange", this.reconcile);
    if (this.bridge) {
      this.detach = this.bridge.onTabsState(state => {
        this.desktopState = state;
        this.reconcile();
      });
      void this.bridge.getTabsState().then(state => {
        // A newer push wins over the initial read.
        this.desktopState ??= state;
        this.reconcile();
      }).catch(() => {});
    } else this.reconcile();
  }

  private reconcile = () => {
    if (this.disposed) return;
    const state = this.desktopState;
    const foreground = !this.bridge || (state?.selfId != null && state.selfId === state.activeId);
    if (this.active && document.visibilityState === "visible" && foreground) {
      if (this.stream) return;
      this.stream = new EventSource(this.url);
      this.stream.onmessage = event => this.onmessage?.(event);
      this.stream.onerror = event => this.onerror?.(event);
    } else {
      this.stream?.close();
      this.stream = null;
    }
  };

  /** Shared renderers can contain several independent tab subtrees. */
  setActive(active: boolean) {
    this.active = active;
    this.reconcile();
  }

  close() {
    this.disposed = true;
    this.detach?.();
    document.removeEventListener("visibilitychange", this.reconcile);
    this.stream?.close();
    this.stream = null;
  }
}
