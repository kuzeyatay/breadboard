"use client";

import { useRef, useState } from "react";

import {
  type GenerativeUiAction,
  type ProductSearchItem,
  type ProductSearchResource,
} from "@/lib/generative-ui/contracts.ts";
import styles from "./product-carousel.module.css";

interface Props {
  resource: ProductSearchResource;
  onAction: (action: GenerativeUiAction) => void;
  activeCompareProductIds?: readonly string[];
}

function ProductImage({ product }: { product: ProductSearchItem }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <div className={styles.imageWell}>
      {product.imageUrl && product.imageUrl !== failedUrl ? (
        // External merchant images are display-only; no proxy or cookies.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(product.imageUrl)}
          className={styles.image}
        />
      ) : (
        <span className={styles.imageFallback}>
          <svg aria-hidden viewBox="0 0 32 32" fill="none" width="32" height="32">
            <path d="m16 3 12 7v12l-12 7-12-7V10l12-7Zm0 13 12-6M16 16 4 10m12 6v13M10 6.5l12 7V19" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span>Image unavailable</span>
        </span>
      )}
    </div>
  );
}

function Rating({ product }: { product: ProductSearchItem }) {
  if (product.rating === undefined) return null;
  return (
    <span className={styles.rating} aria-label={`${product.rating.toFixed(1)} out of 5${product.reviewCount !== undefined ? `, ${product.reviewCount.toLocaleString("en")} reviews` : ""}`}>
      <span aria-hidden className={styles.star}>★</span>
      <span>{product.rating.toFixed(1)}</span>
      {product.reviewCount !== undefined ? <span>({product.reviewCount.toLocaleString("en")})</span> : null}
    </span>
  );
}

export default function ProductCarousel({ resource, onAction, activeCompareProductIds = [] }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const allowed = new Set(resource.actions);
  const compared = new Set(activeCompareProductIds);
  const dispatch = (type: GenerativeUiAction["type"], productId: string) =>
    onAction({ type, resource, productId });
  const move = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({
      left: direction * trackRef.current.clientWidth,
      behavior: "smooth",
    });
  };

  return (
    <section className={`${styles.widget} relative my-4 min-w-0`} aria-label={resource.title} data-generative-ui="product-carousel">
      <header className={styles.header}>
        <div className={styles.heading}>Product picks <span className={styles.count}>{resource.data.products.length}</span></div>
        <div className={styles.navigation}>
          <button type="button" onClick={() => move(-1)} className={styles.arrow} aria-label="Previous products">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" width="18" height="18">
              <path d="m12 5-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" onClick={() => move(1)} className={styles.arrow} aria-label="Next products">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" width="18" height="18">
              <path d="m8 5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>
      <div
        ref={trackRef}
        className="grid touch-pan-x snap-x snap-mandatory auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-px py-px [scrollbar-width:none] sm:auto-cols-[calc((100%_-_3rem)_/_2)] [&::-webkit-scrollbar]:hidden"
      >
        {resource.data.products.map((product) => {
          const compareActive = compared.has(product.id);
          return (
            <article key={product.id} className={styles.card} data-selected={compareActive || undefined}>
              <button type="button" onClick={() => dispatch("product.open-details", product.id)} disabled={!allowed.has("open-details")} className={styles.details} aria-label={`Open details for ${product.title}`}>
                <ProductImage product={product} />
                <div className={styles.body}>
                  <p className={styles.merchant}>{product.merchant}</p>
                  <p className={styles.title}>{product.title}</p>
                  {product.price || product.rating !== undefined ? (
                    <div className={styles.facts}>
                      {product.price ? <span className={styles.price}>{product.price.display}</span> : null}
                      <Rating product={product} />
                    </div>
                  ) : null}
                </div>
              </button>
              <div className={styles.actions}>
                <button type="button" disabled={!allowed.has("find-similar")} onClick={() => dispatch("product.find-similar", product.id)} className={styles.secondary} aria-label={`Find products similar to ${product.title}`}>Similar</button>
                <button type="button" disabled={!allowed.has("compare")} onClick={() => dispatch("product.select", product.id)} aria-pressed={compareActive} aria-label={`${compareActive ? "Deselect" : "Select"} ${product.title} for comparison`} className={styles.secondary}>
                  {compareActive ? "Selected" : "Select"}
                </button>
                <button type="button" disabled={!allowed.has("visit")} onClick={() => dispatch("product.visit", product.id)} className={styles.visit} aria-label={`Visit ${product.merchant} for ${product.title}`}>
                  Visit <svg aria-hidden viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M4 12 12 4M4.5 4H12v7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
