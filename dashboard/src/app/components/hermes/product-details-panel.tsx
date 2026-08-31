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
    <div className="group flex h-56 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-white/75">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.035] motion-reduce:transform-none motion-reduce:transition-none"
        />
      ) : (
        <span className="text-xs text-[var(--ink-muted)]">No image supplied</span>
      )}
    </div>
  );
}

interface ComparisonRow {
  label: string;
  values: string[];
}

function productRating(product: ProductSearchItem): string {
  if (product.rating === undefined) return "Not listed";
  return product.reviewCount === undefined
    ? `${product.rating.toFixed(1)} / 5`
    : `${product.rating.toFixed(1)} / 5 · ${product.reviewCount.toLocaleString()} reviews`;
}

function comparisonRows(products: readonly ProductSearchItem[]): ComparisonRow[] {
  const attributeLabels = [...new Set(products.flatMap((product) =>
    (product.attributes ?? []).map((attribute) => attribute.label),
  ))];
  return [
    ...(products.some((product) => product.price)
      ? [{ label: "Price", values: products.map((product) => product.price?.display ?? "—") }]
      : []),
    { label: "Availability", values: products.map((product) => product.availability ?? "Check retailer") },
    { label: "Rating", values: products.map(productRating) },
    ...(products.some((product) => product.description)
      ? [{ label: "Overview", values: products.map((product) => product.description ?? "Not listed") }]
      : []),
    ...attributeLabels.map((label) => ({
      label,
      values: products.map((product) =>
        product.attributes?.find((attribute) => attribute.label === label)?.value ?? "Not listed",
      ),
    })),
  ];
}

export default function ProductDetailsPanel({ selection, onClose, onAction }: Props) {
  const { resource } = selection;
  const allowed = new Set(resource.actions);
  const selected = productForResource(resource, selection.productId);
  if (!selected) return null;
  const compared = selection.compareProductIds
    .map((id) => productForResource(resource, id))
    .filter((product): product is ProductSearchItem => Boolean(product));
  const comparing = compared.length >= 2;
  const selectedForComparison = selection.compareProductIds.includes(selected.id);
  const rows = comparing ? comparisonRows(compared) : [];
  const dispatch = (type: GenerativeUiAction["type"], productId = selected.id) =>
    onAction({ type, resource, productId });

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            {comparing ? "Product comparison" : "Product details"}
          </p>
          <h2 className="truncate text-sm font-semibold text-[var(--ink-heading)]">
            {comparing
              ? `${compared.length} products selected`
              : selected.title}
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
        {comparing ? (
          <div className="space-y-4" data-testid="product-comparison">
            <div className="grid grid-cols-2 gap-2">
              {compared.map((product) => (
                <article key={product.id} className="group min-w-0">
                  <div className="flex h-28 items-center justify-center overflow-hidden rounded-xl bg-white">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-contain p-2 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.035] motion-reduce:transform-none motion-reduce:transition-none"
                      />
                    ) : null}
                  </div>
                  <h3 className="mt-2 line-clamp-3 text-xs font-semibold leading-4 text-[var(--ink-heading)]">
                    {product.title}
                  </h3>
                  <p className="mt-1 truncate text-[10px] text-[var(--ink-muted)]">{product.merchant}</p>
                </article>
              ))}
            </div>
            <dl className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {rows.map((row) => (
                <div key={row.label} className="py-3">
                  <dt className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                    {row.label}
                  </dt>
                  <div className="grid grid-cols-2 gap-3">
                    {row.values.map((value, index) => (
                      <dd key={`${row.label}:${compared[index]?.id}`} className="min-w-0 text-xs leading-5 text-[var(--ink)]">
                        {value}
                      </dd>
                    ))}
                  </div>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="space-y-4">
            <ProductImage product={selected} />
            <div>
              <h3 className="text-lg font-semibold leading-6 text-[var(--ink-heading)]">
                {selected.title}
              </h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{selected.merchant}</p>
              {selected.price || selected.availability ? (
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {selected.price ? (
                    <span className="text-xl font-semibold text-[var(--ink-heading)]">
                      {selected.price.display}
                    </span>
                  ) : null}
                  {selected.availability ? (
                    <span className="text-xs text-[var(--botanical)]">{selected.availability}</span>
                  ) : null}
                </div>
              ) : null}
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

      </div>

      <footer className="grid grid-cols-3 gap-2 border-t border-[var(--line)] p-3">
        <button type="button" disabled={!allowed.has("find-similar")} onClick={() => dispatch("product.find-similar")} className="neu-button rounded-lg border border-[var(--line)] px-2 py-2 text-xs font-medium disabled:opacity-40">Similar</button>
        <button
          type="button"
          disabled={!allowed.has("compare")}
          onClick={() => dispatch("product.select")}
          aria-pressed={selectedForComparison}
          className={`neu-button rounded-lg border px-2 py-2 text-xs font-medium disabled:opacity-40 ${selectedForComparison ? "border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_12%,transparent)] text-[var(--botanical)]" : "border-[var(--line)]"}`}
        >
          {selectedForComparison ? "Selected" : "Select"}
        </button>
        <button type="button" disabled={!allowed.has("visit")} onClick={() => dispatch("product.visit")} className="rounded-lg bg-[var(--botanical)] px-2 py-2 text-xs font-semibold text-[var(--paper-raised)] hover:bg-[var(--botanical-hover)] disabled:opacity-40">Visit</button>
      </footer>
    </div>
  );
}
