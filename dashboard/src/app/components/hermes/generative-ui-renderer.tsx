"use client";

import ProductCarousel from "./product-carousel";
import {
  type GenerativeUiAction,
  type GenerativeUiResource,
} from "@/lib/generative-ui/contracts.ts";

interface Props {
  resources: GenerativeUiResource[];
  onAction: (action: GenerativeUiAction) => void;
  activeProductComparison?: {
    resourceId: string;
    productIds: readonly string[];
  } | null;
}
/** The only component registry. Resource payloads never choose an import. */
export default function GenerativeUiRenderer({
  resources,
  onAction,
  activeProductComparison = null,
}: Props) {
  return resources.map((resource) => {
    switch (resource.renderer) {
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
    }
  });
}
