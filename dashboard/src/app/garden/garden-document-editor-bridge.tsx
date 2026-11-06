"use client";

import { useEffect, type RefObject } from "react";
import { exportMarkdownPage } from "@/lib/markdown-page-export";
import { canonicalQuartzSlug } from "./use-canonical-quartz-document";
import { installTextHighlightBridge } from "@/lib/text-highlight-transport";
import { quartzImageSources } from "@/lib/quartz-image-sources";

/** The sole authenticated transport for the editor in every garden reader. */
export default function GardenDocumentEditorBridge({ iframeRef, quartzOrigin }: {
  iframeRef: RefObject<HTMLIFrameElement | null>; quartzOrigin: string;
}) {
  useEffect(() => installTextHighlightBridge(() => iframeRef.current?.contentWindow, quartzOrigin), [iframeRef, quartzOrigin]);
  useEffect(() => {
    let disposed = false;
    const pending = new Set<AbortController>();
    const inFlight = new Set<string>();
    const receive = async (event: MessageEvent) => {
      if (!quartzOrigin || event.origin !== quartzOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type !== "second-brain:document-editor" || typeof data.slug !== "string" ||
          typeof data.sessionId !== "string" || typeof data.requestId !== "string") return;
      const requestKey = `${data.sessionId}:${data.requestId}`;
      if (inFlight.has(requestKey)) return;
      inFlight.add(requestKey);
      const source = event.source as Window;
      const reply = (body: object) => !disposed && source.postMessage({
        // API slugs are file basenames; the transport identifies the full Quartz
        // path. Never let response data replace the request's correlation fields.
        ...body, type: "second-brain:document-editor-result", slug: data.slug, sessionId: data.sessionId, requestId: data.requestId,
      }, quartzOrigin);
      const controller = new AbortController(); pending.add(controller);
      try {
        const segments = decodeURIComponent(data.slug).split("/").filter(Boolean);
        if (segments[0] === "garden") segments.shift();
        const clusterSlug = segments.shift(), noteSlug = segments.join("/");
        if (!clusterSlug || !noteSlug) throw new Error("This page cannot be edited.");
        const endpoint = `/api/documents/${encodeURIComponent(noteSlug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`;
        const getFolder = () => fetch(`/api/folders?${new URLSearchParams({ clusterSlug,
          folder: noteSlug.replace(/\/(?:_?index)$/, ''), render: '1' })}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (data.action === "export") {
          const format = data.payload?.format;
          if (format !== "markdown" && format !== "pdf") throw new Error("Unknown export format.");
          const message = await exportMarkdownPage({ clusterSlug, slug: noteSlug, action: format, signal: controller.signal });
          reply({ ok: true, message });
          return;
        }
        let response: Response;
        const send = (url: string, method: string, body: unknown) => fetch(url, { method, signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        switch (data.action) {
          case "folder": response = await getFolder(); break;
          case "get":
            if (data.payload?.render === true && /\/_?index$/.test(noteSlug)) response = await getFolder();
            else {
              response = await fetch(endpoint + (data.payload?.render === true ? "&render=1" : ""), { cache: "no-store", signal: controller.signal });
              // An unpublished clean folder URL borrows note chrome. Resolve it
              // from disk when there is no note at that address.
              if (response.status === 404 && data.payload?.render === true) response = await getFolder();
            }
            break;
          case "delete": response = await fetch(endpoint, { method: "DELETE", signal: controller.signal }); break;
          case "save":
            if (typeof data.payload?.baseRevision !== "string") throw new Error("Reload the page before saving.");
            response = await send(endpoint, "PATCH", data.payload); break;
          case "preview": response = await send(endpoint, "POST", data.payload); break;
          case "images": response = await send("/api/markdown-images", "POST", { ...data.payload, clusterSlug, noteSlug }); break;
          case "youtube": response = await send("/api/markdown-videos", "POST", { youtubeUrl: data.payload?.url, clusterSlug, noteSlug }); break;
          case "video": {
            const file = data.payload?.file;
            if (!(file instanceof File)) throw new Error("Could not read the video.");
            response = await fetch(`/api/markdown-videos?${new URLSearchParams({ clusterSlug, noteSlug, fileName: file.name })}`, {
              method: "POST", signal: controller.signal, headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }); break;
          }
          default: throw new Error("Unknown editor request.");
        }
        const body = await response.json();
        if (typeof body.reader?.html === "string") {
          body.reader.html = quartzImageSources(body.reader.html, body.reader.slug || data.slug, quartzOrigin, window.location.origin);
        }
        if (data.action === "preview" && Array.isArray(body.fragments)) {
          for (const fragment of body.fragments) if (typeof fragment.html === "string") {
            fragment.html = quartzImageSources(fragment.html, data.slug, quartzOrigin, window.location.origin);
          }
        }
        if (data.action === "delete" && response.ok && body.success) {
          const paths = Array.isArray(body.deletedPaths) ? body.deletedPaths : [noteSlug];
          window.dispatchEvent(new CustomEvent("sb:markdown-deleted", { detail: {
            cluster: clusterSlug, slugs: paths.map((path: string) => canonicalQuartzSlug(clusterSlug, path)),
          } }));
        }
        reply({ ...body, ok: response.ok && body.success, status: response.status });
        if (data.action === "save" && response.ok) {
          window.dispatchEvent(new CustomEvent("sb:markdown-updated", { detail: { cluster: clusterSlug, slug: noteSlug, editorSessionId: data.sessionId, revision: body.revision, content: data.payload?.body, title: body.title } }));
        }
      } catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : "Could not save this page." }); }
      finally { pending.delete(controller); inFlight.delete(requestKey); }
    };
    window.addEventListener("message", receive);
    return () => { disposed = true; window.removeEventListener("message", receive); for (const request of pending) request.abort(); };
  }, [iframeRef, quartzOrigin]);
  return null;
}
