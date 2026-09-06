import { randomUUID } from "node:crypto";
import type { WebContents, WebFrameMain } from "electron";
import type { BrowserTranslationState } from "../shared/browser-preferences";
import { translationDocumentScript } from "./browser-translation-dom";

export interface TranslationSegment { id: number; text: string; context: string }
export type TranslatePageBatch = (segments: TranslationSegment[], language: string, signal: AbortSignal) => Promise<Array<{ id: number; text: string }>>;

export class BrowserTranslation {
  state: BrowserTranslationState = { status: "original", language: "en", translated: 0 };
  private key = "";
  private generation = 0;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private documents = new Set<WebFrameMain>();
  private characters = 0;
  constructor(private readonly contents: WebContents, private readonly translate: TranslatePageBatch, private readonly changed: () => void) {
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        // Do not execute scripts in a frame while Chromium is tearing it down.
        // Keep originals until commit so a cancelled navigation can still restore.
        this.generation++;
        clearTimeout(this.timer);
        this.controller?.abort();
      }
    });
    contents.on("did-navigate", () => this.reset());
    contents.on("did-stop-loading", () => {
      if (this.key && this.controller?.signal.aborted) this.publish({
        ...this.state, status: "error", error: "Translation paused when navigation stopped. Retry to continue.",
      });
    });
    contents.once("destroyed", () => this.reset());
  }
  private publish(next: BrowserTranslationState) { this.state = next; this.changed(); }
  private reset() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.documents.clear();
    this.key = "";
    this.characters = 0;
    this.publish({ status: "original", language: this.state.language, translated: 0 });
  }
  private async execute(frame: WebFrameMain, operation: "collect" | "apply" | "restore", payload?: unknown, key = this.key): Promise<unknown> {
    const script = translationDocumentScript(key, operation, payload);
    return frame === this.contents.mainFrame
      ? this.contents.executeJavaScriptInIsolatedWorld(1004, [{ code: script }])
      : frame.executeJavaScript(script);
  }
  async restore(): Promise<void> {
    const frames = [...this.documents], key = this.key;
    this.reset();
    if (!key || this.contents.isDestroyed()) return;
    await Promise.allSettled(frames.map(frame => this.execute(frame, "restore", undefined, key)));
  }
  async start(language: string): Promise<void> {
    const generation = this.generation + 1;
    await this.restore();
    if (this.contents.isDestroyed() || this.generation !== generation) return;
    this.key = `__breadboard_translation_${randomUUID().replace(/-/g, "")}`;
    this.controller = new AbortController();
    this.publish({ status: "translating", language, translated: 0 });
    void this.tick(this.generation);
  }
  private async tick(generation: number): Promise<void> {
    const live = () => generation === this.generation && !this.contents.isDestroyed() && !this.controller?.signal.aborted;
    try {
      let hadWork = false;
      const frames = this.contents.mainFrame.framesInSubtree;
      for (const frame of this.documents) if (!frames.includes(frame)) this.documents.delete(frame);
      for (const frame of frames) {
        if (!live()) return;
        // Include same-origin and cross-origin embedded documents, never local files.
        if (!/^https?:/.test(frame.url) && !/^about:(blank|srcdoc)$/.test(frame.url)) continue;
        this.documents.add(frame);
        let data: unknown;
        try { data = await this.execute(frame, "collect"); } catch { continue; }
        if (!live()) return;
        if (!Array.isArray(data) || data.length > 40) continue;
        const batch = data as TranslationSegment[];
        if (!batch.every(value => Number.isSafeInteger(value.id) && typeof value.text === "string" && value.text.length <= 12000 && typeof value.context === "string" && value.context.length <= 300)) continue;
        if (!batch.length) continue;
        hadWork = true;
        this.characters += batch.reduce((size, value) => size + value.text.length, 0);
        if (this.characters > 500_000) throw new Error("This page has reached the translation limit. Show original and translate again to continue.");
        this.publish({ ...this.state, status: "translating" });
        const result = await this.translate(batch, this.state.language, this.controller!.signal);
        if (!live()) return;
        if (result.length !== batch.length || !result.every((value, index) => value.id === batch[index]!.id && typeof value.text === "string" && value.text.length <= 36000)) {
          throw new Error("The translation response was incomplete. Try again.");
        }
        let count: unknown;
        try { count = await this.execute(frame, "apply", result); } catch { continue; }
        if (!live()) return;
        this.publish({ ...this.state, translated: this.state.translated + (typeof count === "number" ? count : 0) });
      }
      if (!live()) return;
      if (!hadWork) this.publish({ ...this.state, status: "translated" });
      this.timer = setTimeout(() => { void this.tick(generation); }, hadWork ? 30 : 1000);
      this.timer.unref();
    } catch (error) {
      if (live()) this.publish({ ...this.state, status: "error", error: error instanceof Error ? error.message : "Translation failed. Try again." });
    }
  }
}
