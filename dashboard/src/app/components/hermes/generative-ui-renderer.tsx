"use client";

import ProductCarousel from "./product-carousel";
import {
  type GenerativeUiAction,
  type GenerativeUiResource,
} from "@/lib/generative-ui/contracts.ts";

interface Props {
  resources: GenerativeUiResource[];
  onAction: (action: GenerativeUiAction) => void;
}
/** The only component registry. Resource payloads never choose an import. */
export default function GenerativeUiRenderer({ resources, onAction }: Props) {
  return resources.map((resource) => {
    switch (resource.renderer) {
      case "product-carousel":
        return (
          <ProductCarousel
            key={resource.id}
            resource={resource}
            onAction={onAction}
          />
        );
    }
  });
}
