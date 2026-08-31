"use client";

import { useRef } from "react";

import {
  type GenerativeUiAction,
  type ProductSearchItem,
  type ProductSearchResource,
} from "@/lib/generative-ui/contracts.ts";

interface Props {
  resource: ProductSearchResource;
  onAction: (action: GenerativeUiAction) => void;
}
function Rating({ product }: { product: ProductSearchItem }) {
  if (product.rating === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-muted)]">
      <span aria-hidden className="text-[#9B6C2F]">★</span>
      <span>{product.rating.toFixed(1)}</span>
      {product.reviewCount !== undefined ? (
        <span>({product.reviewCount.toLocaleString()})</span>
      ) : null}
    </span>
  );
}

export default function ProductCarousel({ resource, onAction }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const allowed = new Set(resource.actions);
  const dispatch = (
    type: GenerativeUiAction["type"],
    productId: string,
  ) => onAction({ type, resource, productId });
  const move = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({
      left: direction * Math.max(260, trackRef.current.clientWidth * 0.72),
      behavior: "smooth",
    });
  };

  return (
    <section
      className="my-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_10px_26px_rgba(41,55,47,0.08)]"
      aria-labelledby={`${resource.id}-title`}
      data-generative-ui="product-carousel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <h3
            id={`${resource.id}-title`}
            className="truncate text-sm font-semibold text-[var(--ink-heading)]"
          >
            {resource.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
            {resource.data.products.length} sourced result{resource.data.products.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => move(-1)}
            className="neu-button flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
            aria-label="Previous products"
          >
            <span aria-hidden>←</span>
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            className="neu-button flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
            aria-label="Next products"
          >
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 [scrollbar-width:thin]"
      >
        {resource.data.products.map((product) => (
          <article
            key={product.id}
            className="group flex w-[232px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-surface)]"
          >
            <button
              type="button"
              onClick={() => dispatch("product.open-details", product.id)}
              disabled={!allowed.has("open-details")}
              className="flex flex-1 flex-col text-left disabled:cursor-default"
              aria-label={`Open details for ${product.title}`}
            >
              <div className="flex h-36 w-full items-center justify-center overflow-hidden bg-white/70">
                {product.imageUrl ? (
                  // External product images are display-only HTTPS URLs from
                  // the inspected source set; no Next image proxy or cookies.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.025]"
                  />
                ) : (
                  <span className="text-xs text-[var(--ink-muted)]">No image supplied</span>
                )}
              </div>
              <div className="flex flex-1 flex-col px-3 pb-2 pt-3">
                <p className="line-clamp-2 min-h-10 text-[13px] font-semibold leading-5 text-[var(--ink-heading)]">
                  {product.title}
                </p>
                <p className="mt-1 truncate text-[11px] text-[var(--ink-muted)]">
                  {product.merchant}
                </p>
                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  <span className="text-sm font-semibold text-[var(--ink-heading)]">
                    {product.price?.display ?? "Price unavailable"}
                  </span>
                  <Rating product={product} />
                </div>
              </div>
            </button>
            <div className="grid grid-cols-3 gap-1 border-t border-[var(--line)] p-2">
              <button
                type="button"
                disabled={!allowed.has("find-similar")}
                onClick={() => dispatch("product.find-similar", product.id)}
                className="rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40"
              >
                Similar
              </button>
              <button
                type="button"
                disabled={!allowed.has("compare")}
                onClick={() => dispatch("product.compare", product.id)}
                className="rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40"
              >
                Compare
              </button>
              <button
                type="button"
                disabled={!allowed.has("visit")}
                onClick={() => dispatch("product.visit", product.id)}
                className="rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-[var(--botanical)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40"
              >
                Visit
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="border-t border-[var(--line)] px-4 py-2 text-[10px] text-[var(--ink-muted)]">
        Product facts come from {resource.data.sources.length} linked source{resource.data.sources.length === 1 ? "" : "s"}; prices and availability may change.
      </div>
    </section>
  );
}
