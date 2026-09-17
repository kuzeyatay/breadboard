"use client";

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
export default function GenerativeUiRenderer({
  resources,
  conversationPublicId,
  legacyChatSessionId,
  onAction,
  activeProductComparison = null,
}: Props) {
  return resources.map((resource) => {
    switch (resource.renderer) {
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
