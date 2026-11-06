"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { quartzImageSources } from "@/lib/quartz-image-sources";

interface ActiveMarkdown { cluster: string; slug: string; title?: string; content?: string; loading?: boolean }

export function canonicalQuartzSlug(cluster: string, slug: string): string {
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* Keep the original path. */ }
  const relative = decoded.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.(?:md|html)$/i, "");
  const full = relative.startsWith(`${cluster}/`) ? relative : `${cluster}/${relative}`;
  return full.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/[?#]/g, "");
}

export function useCanonicalQuartzDocument(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  quartzOrigin: string,
  active: ActiveMarkdown | null,
  setActive: Dispatch<SetStateAction<ActiveMarkdown | null>>,
  ready = true,
) {
  const cluster = active?.cluster, slug = active?.slug;
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    if (!ready || !cluster || !slug || !quartzOrigin) { setError(null); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(cluster)}&render=1`, {
        signal: controller.signal, cache: "no-store",
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !body.success || typeof body.content !== "string" || typeof body.reader?.html !== "string") {
        throw new Error(body.error || "Could not refresh the saved page.");
      }
      body.reader.html = quartzImageSources(body.reader.html, body.reader.slug || canonicalQuartzSlug(cluster, slug), quartzOrigin, window.location.origin);
      setActive(current => current?.cluster === cluster && current.slug === slug
        ? { ...current, content: body.content, title: body.title || current.title, loading: false } : current);
      await new Promise<void>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const cleanup = () => { window.clearTimeout(timer); window.clearInterval(retry); window.removeEventListener("message", rendered); controller.signal.removeEventListener("abort", aborted); };
        const aborted = () => { cleanup(); resolve(); };
        const rendered = (event: MessageEvent) => {
          if (event.source !== iframeRef.current?.contentWindow || event.origin !== quartzOrigin || event.data?.type !== "second-brain:canonical-document-rendered" || event.data.requestId !== requestId) return;
          cleanup(); resolve();
        };
        const timer = window.setTimeout(() => { cleanup(); reject(new Error("Could not refresh the saved page.")); }, 5_000);
        window.addEventListener("message", rendered);
        controller.signal.addEventListener("abort", aborted, { once: true });
        const send = () => iframeRef.current?.contentWindow?.postMessage({ type: "second-brain:canonical-document", ...body.reader, revision: body.revision, requestId }, quartzOrigin);
        // A recovering frame may still be installing its bridge. Re-send the
        // same idempotent update until that document acknowledges readiness.
        const retry = window.setInterval(send, 500);
        send();
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setActive(current => current?.cluster === cluster && current.slug === slug ? { ...current, loading: false } : current);
      setError(cause instanceof Error ? cause.message : "Could not refresh the saved page.");
    }
  }, [cluster, slug, quartzOrigin, iframeRef, setActive, ready]);

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ActiveMarkdown> & { editorSessionId?: string }>).detail;
      if (!cluster || !slug || !detail?.cluster || !detail.slug) return;
      if (canonicalQuartzSlug(cluster, slug) !== canonicalQuartzSlug(detail.cluster, detail.slug)) return;
      if (detail.editorSessionId) {
        setActive(current => current?.cluster === cluster && current.slug === slug ? {
          ...current, ...(detail.content !== undefined ? { content: detail.content } : {}),
          ...(detail.title ? { title: detail.title } : {}),
        } : current);
        return;
      }
      void refresh();
    };
    // A full iframe reload can land on the same slug, so it must explicitly
    // refresh too; React's slug dependency alone does not change in that case.
    const requestNavigation = () => {
      if (quartzOrigin) iframeRef.current?.contentWindow?.postMessage({ type: "second-brain:request-navigation" }, quartzOrigin);
    };
    const loaded = () => { requestNavigation(); void refresh(); };
    const deleted = (event: Event) => {
      const detail = (event as CustomEvent<{ slugs?: string[] }>).detail;
      if (!cluster || !slug || !detail?.slugs?.includes(canonicalQuartzSlug(cluster, slug))) return;
      requestRef.current?.abort();
      setError(null);
      setActive(current => current?.cluster === cluster && current.slug === slug ? null : current);
    };
    const frame = iframeRef.current;
    frame?.addEventListener("load", loaded);
    requestNavigation();
    window.addEventListener("sb:markdown-updated", updated);
    window.addEventListener("sb:markdown-deleted", deleted);
    return () => {
      frame?.removeEventListener("load", loaded);
      window.removeEventListener("sb:markdown-updated", updated);
      window.removeEventListener("sb:markdown-deleted", deleted);
    };
  }, [cluster, slug, refresh, iframeRef, quartzOrigin, setActive]);
  return { error, retry: refresh };
}
