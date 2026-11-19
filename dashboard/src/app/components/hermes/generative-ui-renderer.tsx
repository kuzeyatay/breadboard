"use client";
import { memo } from "react";

import { ArrowUpRight, ListMusic } from "lucide-react";
import BambuPrintCard from "./bambu-print-card";
import ProductCarousel from "./product-carousel";
import GardenNavigator from "./garden-navigator";
import ChatSearchResults from "./chat-search-results";
import {
  type GenerativeUiAction,
  type GenerativeUiResource,
} from "@/lib/generative-ui/contracts.ts";

interface Props {
  resources: GenerativeUiResource[];
  conversationPublicId?: string | null;
  legacyChatSessionId?: number | null;
  onAction: (action: GenerativeUiAction) => void;
  activeProductComparison?: {
    resourceId: string;
    productIds: readonly string[];
  } | null;
}
/** The only component registry. Resource payloads never choose an import. */
function GenerativeUiRenderer({
  resources,
  conversationPublicId,
  legacyChatSessionId,
  onAction,
  activeProductComparison = null,
}: Props) {
  return resources.map((resource) => {
    switch (resource.renderer) {
      case "spotify-playlist-card":
        return (
          <a
            key={resource.id}
            href={`https://open.spotify.com/playlist/${resource.data.playlistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group mb-4 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-[var(--ink-heading)] hover:border-[var(--botanical)]"
          >
            <ListMusic aria-hidden className="size-6 shrink-0 text-[var(--botanical)]" />
            <span className="min-w-0 flex-1">
              <strong className="block break-words">{resource.title}</strong>
              <span className="text-xs text-[var(--ink-muted)]">
                {resource.data.trackCount} {resource.data.trackCount === 1 ? "track" : "tracks"}
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm">Open in Spotify <ArrowUpRight aria-hidden className="size-4 shrink-0" /></span>
          </a>
        );
      case "bambu-print-card":
        return ((conversationPublicId === resource.data.conversationPublicId) || (!conversationPublicId && Boolean(legacyChatSessionId))) ? <BambuPrintCard key={resource.id} resource={resource} legacyChatSessionId={legacyChatSessionId} /> : null;
      case "product-carousel":
        return (
          <ProductCarousel
            key={resource.id}
            resource={resource}
            onAction={onAction}
            activeCompareProductIds={
              activeProductComparison?.resourceId === resource.id
                ? activeProductComparison.productIds
                : []
            }
          />
        );
      case "garden-navigator":
        return <GardenNavigator key={resource.id} resource={resource} />;
      case "chat-search-results":
        return <ChatSearchResults key={resource.id} resource={resource} />;
    }
  });
}

// Rows re-render on every streamed token; this one only when its own props change.
export default memo(GenerativeUiRenderer);
