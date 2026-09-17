"use client";

import { useEffect, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { artifactReferenceMarkdown, parseArtifactReference } from "@/lib/generated/artifact-reference";

const ArtifactViewer = dynamic(() => import("@/app/components/hermes/artifact-viewer"), { ssr: false });

/** Keep private artifact requests on the authenticated dashboard origin. */
export default function GardenMarkdownArtifacts({ iframeRef, quartzOrigin }: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  quartzOrigin: string;
}) {
  const [artifact, setArtifact] = useState<PresentedArtifact | null>(null);

  useEffect(() => {
    const pending = new Set<AbortController>();
    let activeOpenRequest = "";
    let disposed = false;
    const reset = () => {
      activeOpenRequest = "";
      for (const controller of pending) controller.abort();
      setArtifact(null);
    };
    const handleMessage = async (event: MessageEvent) => {
      if (!quartzOrigin || event.origin !== quartzOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "second-brain:navigate") { reset(); return; }
      const list = data?.type === "second-brain:list-markdown-artifacts";
      const preview = data?.type === "second-brain:preview-markdown-artifact";
      if (!list && !preview && data?.type !== "second-brain:open-markdown-artifact") return;
      if (typeof data.slug !== "string" || typeof data.requestId !== "string") return;
      const source = iframeRef.current?.contentWindow;
      const reply = (body: Record<string, unknown>) => !disposed && source?.postMessage({
        type: list ? "second-brain:markdown-artifacts-result" : preview ? "second-brain:markdown-artifact-preview-result" : "second-brain:markdown-artifact-open-result",
        slug: data.slug, requestId: data.requestId, ...body,
      }, quartzOrigin);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      pending.add(controller);
      if (!list && !preview) activeOpenRequest = data.requestId;
      try {
        const segments = decodeURIComponent(data.slug).split("/").filter(Boolean);
        const gardenSlug = segments[0] === "garden" ? segments[1] : segments[0];
        if (!gardenSlug) throw new Error("Could not resolve this garden.");
        if (list) {
          const query = new URLSearchParams({ gardenSlug, sourceSurface: "garden_chat" });
          const response = await fetch(`/api/hermes/artifacts?${query}`, { signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Could not load artifacts.");
          const items = (Array.isArray(body.artifacts) ? body.artifacts : []) as PresentedArtifact[];
          const artifacts = items.filter(item => item.gardenId === gardenSlug && item.status === "ready" &&
            (item.previewAvailable || item.downloadAvailable)).map(item => ({
              id: item.id, title: item.title, kind: item.kind, renderer: item.renderer, filename: item.filename,
              updatedAt: item.updatedAt,
              thumbnailUrl: item.kind === "image" && item.previewAvailable
                ? new URL(`/api/hermes/artifacts/${encodeURIComponent(item.id)}/preview?${new URLSearchParams({ conversationId: item.conversationId, version: String(item.version) })}`, window.location.origin).href
                : undefined,
              markdown: artifactReferenceMarkdown(item),
            }));
          if (!controller.signal.aborted) reply({ ok: true, artifacts });
        } else {
          const reference = parseArtifactReference(JSON.stringify(data.reference));
          if (!reference) throw new Error("This artifact reference is invalid.");
          const query = new URLSearchParams({ conversationId: reference.conversationId });
          const response = await fetch(`/api/hermes/artifacts/${encodeURIComponent(reference.id)}?${query}`, { signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "This artifact is no longer available.");
          if (body.artifact?.gardenId !== gardenSlug) throw new Error("This artifact does not belong to this garden.");
          if (preview) {
            const item = body.artifact as PresentedArtifact;
            const interactive = item.renderer === "interactive-visualizer";
            if (item.status !== "ready" || !item.previewAvailable || (item.kind !== "html" && !interactive)) {
              if (!controller.signal.aborted) reply({ ok: true, inline: false });
              return;
            }
            const params = new URLSearchParams({ conversationId: item.conversationId, version: String(item.version), channel: data.requestId });
            const rendered = await fetch(`/api/hermes/artifacts/${encodeURIComponent(item.id)}/preview?${params}`, { signal: controller.signal });
            if (!rendered.ok) throw new Error("Could not load the preview. Try again.");
            if (!rendered.headers.get("content-type")?.toLowerCase().startsWith("text/html")) throw new Error("This artifact has no HTML preview.");
            const html = await rendered.text();
            // srcdoc avoids framing a private dashboard route through a different
            // Quartz origin. Preserve its CSP inside the opaque sandbox.
            const policy = rendered.headers.get("content-security-policy");
            if (!policy) throw new Error("This preview could not be loaded safely.");
            const metaPolicy = policy.split(";").filter(rule => !/^\s*frame-ancestors\b/i.test(rule)).join(";");
            const escapedPolicy = metaPolicy.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
            if (!controller.signal.aborted) reply({ ok: true, inline: true, interactive, title: item.title,
              html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escapedPolicy}">${html}` });
          } else if (!controller.signal.aborted && activeOpenRequest === data.requestId) {
            setArtifact(body.artifact);
            reply({ ok: true });
          }
        }
      } catch (error) {
        reply({ ok: false, error: error instanceof Error && error.name !== "AbortError" ? error.message : "The request timed out. Try again." });
      } finally {
        clearTimeout(timeout);
        pending.delete(controller);
      }
    };
    const frame = iframeRef.current;
    // Embedded artifacts request their previews while Quartz is hydrating,
    // before the outer frame fires load. Do not abort those fresh requests.
    const onFrameLoad = () => {
      activeOpenRequest = "";
      setArtifact(null);
    };
    frame?.addEventListener("load", onFrameLoad);
    window.addEventListener("message", handleMessage);
    return () => {
      disposed = true;
      frame?.removeEventListener("load", onFrameLoad);
      window.removeEventListener("message", handleMessage);
      for (const controller of pending) controller.abort();
    };
  }, [iframeRef, quartzOrigin]);

  return artifact ? <ArtifactViewer artifact={artifact} onClose={() => setArtifact(null)} onUpdated={setArtifact} /> : null;
}
