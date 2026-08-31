"use client";

import {
  productForResource,
  type GenerativeUiAction,
  type ProductSearchItem,
  type ProductSearchResource,
} from "@/lib/generative-ui/contracts.ts";

export interface ProductPanelSelection {
  resource: ProductSearchResource;
  productId: string;
  compareProductIds: string[];
}

interface Props {
  selection: ProductPanelSelection;
  onClose: () => void;
  onAction: (action: GenerativeUiAction) => void;
}

function ProductImage({ product }: { product: ProductSearchItem }) {
  return (
    <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-white/75">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-4"
        />
      ) : (
        <span className="text-xs text-[var(--ink-muted)]">No image supplied</span>
      )}
    </div>
  );
}

export default function ProductDetailsPanel({ selection, onClose, onAction }: Props) {
  const { resource } = selection;
  const allowed = new Set(resource.actions);
  const selected = productForResource(resource, selection.productId);
  if (!selected) return null;
  const compared = selection.compareProductIds
    .map((id) => productForResource(resource, id))
    .filter((product): product is ProductSearchItem => Boolean(product));
  const sources = resource.data.sources.filter((source) =>
    selected.sourceIds.includes(source.id),
  );
  const dispatch = (type: GenerativeUiAction["type"], productId = selected.id) =>
    onAction({ type, resource, productId });

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Product details
          </p>
          <h2 className="truncate text-sm font-semibold text-[var(--ink-heading)]">
            {compared.length > 1 ? `Comparing ${compared.length} products` : selected.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="neu-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
          aria-label="Close product details"
        >
          <span aria-hidden>×</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {compared.length > 1 ? (
          <div className="space-y-3" data-testid="product-comparison">
            {compared.map((product) => (
              <article key={product.id} className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3">
                <div className="flex gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain p-1" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-5 text-[var(--ink-heading)]">{product.title}</h3>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{product.merchant}</p>
                    <p className="mt-2 text-sm font-semibold">{product.price?.display ?? "Price unavailable"}</p>
                  </div>
                </div>
                {product.attributes?.length ? (
                  <dl className="mt-3 grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[var(--line)] pt-3 text-xs">
                    {product.attributes.slice(0, 6).map((attribute) => (
                      <div key={`${product.id}:${attribute.label}`} className="contents">
                        <dt className="text-[var(--ink-muted)]">{attribute.label}</dt>
                        <dd className="text-[var(--ink)]">{attribute.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <ProductImage product={selected} />
            <div>
              <h3 className="text-lg font-semibold leading-6 text-[var(--ink-heading)]">
                {selected.title}
              </h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{selected.merchant}</p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-semibold text-[var(--ink-heading)]">
                  {selected.price?.display ?? "Price unavailable"}
                </span>
                {selected.availability ? (
                  <span className="text-xs text-[var(--botanical)]">{selected.availability}</span>
                ) : null}
              </div>
              {selected.rating !== undefined ? (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  <span className="text-[#9B6C2F]">★</span> {selected.rating.toFixed(1)}
                  {selected.reviewCount !== undefined ? ` from ${selected.reviewCount.toLocaleString()} reviews` : ""}
                </p>
              ) : null}
            </div>
            {selected.description ? (
              <p className="text-sm leading-6 text-[var(--ink)]">{selected.description}</p>
            ) : null}
            {selected.attributes?.length ? (
              <dl className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-xs">
                {selected.attributes.map((attribute) => (
                  <div key={attribute.label} className="contents">
                    <dt className="text-[var(--ink-muted)]">{attribute.label}</dt>
                    <dd>{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        )}

        <section className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Sources</h3>
          <ul className="mt-2 space-y-2">
            {sources.map((source) => (
              <li key={source.id} className="text-xs">
                <button
                  type="button"
                  disabled={!allowed.has("visit")}
                  onClick={() => dispatch("product.visit")}
                  className="text-left text-[var(--botanical)] hover:underline disabled:opacity-40"
                >
                  {source.title}
                </button>
                <span className="ml-2 text-[var(--ink-muted)]">{source.site}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="grid grid-cols-3 gap-2 border-t border-[var(--line)] p-3">
        <button type="button" disabled={!allowed.has("find-similar")} onClick={() => dispatch("product.find-similar")} className="neu-button rounded-lg border border-[var(--line)] px-2 py-2 text-xs font-medium disabled:opacity-40">Similar</button>
        <button type="button" disabled={!allowed.has("compare")} onClick={() => dispatch("product.compare")} className="neu-button rounded-lg border border-[var(--line)] px-2 py-2 text-xs font-medium disabled:opacity-40">Compare</button>
        <button type="button" disabled={!allowed.has("visit")} onClick={() => dispatch("product.visit")} className="rounded-lg bg-[var(--botanical)] px-2 py-2 text-xs font-semibold text-[var(--paper-raised)] hover:bg-[var(--botanical-hover)] disabled:opacity-40">Visit</button>
      </footer>
    </div>
  );
}
