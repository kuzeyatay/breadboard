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
  activeCompareProductIds?: readonly string[];
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

export default function ProductCarousel({
  resource,
  onAction,
  activeCompareProductIds = [],
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const allowed = new Set(resource.actions);
  const compared = new Set(activeCompareProductIds);
  const dispatch = (
    type: GenerativeUiAction["type"],
    productId: string,
  ) => onAction({ type, resource, productId });
  const move = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({
      left: direction * trackRef.current.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section
      className="relative my-4 min-w-0"
      aria-label={resource.title}
      data-generative-ui="product-carousel"
    >
      <div
        ref={trackRef}
        className="grid touch-pan-x snap-x snap-mandatory auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-px py-px [scrollbar-width:none] sm:auto-cols-[calc((100%_-_3rem)_/_2)] [&::-webkit-scrollbar]:hidden"
      >
        {resource.data.products.map((product) => {
          const compareActive = compared.has(product.id);
          return (
          <article
            key={product.id}
            className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--paper-raised)] shadow-[0_1px_2px_rgba(41,55,47,0.06),0_0_0_1px_var(--line)]"
          >
            <button
              type="button"
              onClick={() => dispatch("product.open-details", product.id)}
              disabled={!allowed.has("open-details")}
              className="flex flex-1 flex-col text-left disabled:cursor-default"
              aria-label={`Open details for ${product.title}`}
            >
              <div className="flex h-40 w-full items-center justify-center overflow-hidden bg-white/75">
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
                    className="h-full w-full object-contain p-2 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.035] motion-reduce:transform-none motion-reduce:transition-none"
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
                {product.price || product.rating !== undefined ? (
                  <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                    {product.price ? (
                      <span className="text-sm font-semibold text-[var(--ink-heading)]">
                        {product.price.display}
                      </span>
                    ) : null}
                    <Rating product={product} />
                  </div>
                ) : null}
              </div>
            </button>
            <div className="grid grid-cols-3 gap-1 px-2 pb-2 pt-1">
              <button
                type="button"
                disabled={!allowed.has("find-similar")}
                onClick={() => dispatch("product.find-similar", product.id)}
                className="rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-[var(--ink)] transition-[background-color,transform] duration-150 hover:bg-[var(--paper-strong)] active:scale-[0.97] disabled:opacity-40"
              >
                Similar
              </button>
              <button
                type="button"
                disabled={!allowed.has("compare")}
                onClick={() => dispatch("product.select", product.id)}
                aria-pressed={compareActive}
                className={`rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] disabled:opacity-40 ${compareActive ? "bg-[color-mix(in_srgb,var(--botanical)_12%,transparent)] text-[var(--botanical)]" : "text-[var(--ink)] hover:bg-[var(--paper-strong)]"}`}
              >
                {compareActive ? "Selected" : "Select"}
              </button>
              <button
                type="button"
                disabled={!allowed.has("visit")}
                onClick={() => dispatch("product.visit", product.id)}
                className="rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-[var(--botanical)] transition-[background-color,transform] duration-150 hover:bg-[var(--paper-strong)] active:scale-[0.97] disabled:opacity-40"
              >
                Visit
              </button>
            </div>
          </article>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => move(-1)}
        className="absolute left-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.72)] transition-transform duration-150 hover:scale-105 active:scale-95"
        aria-label="Previous products"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-6 w-6">
          <path d="m12.5 4.5-5 5.5 5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        className="absolute right-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.72)] transition-transform duration-150 hover:scale-105 active:scale-95"
        aria-label="Next products"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-6 w-6">
          <path d="m7.5 4.5 5 5.5-5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  );
}
