"use client";

import { ArrowUpRight, BookOpen, Sprout } from "lucide-react";

import LinkContextMenu from "@/app/components/link-context-menu";
import type { GardenNavigationResource } from "@/lib/generative-ui/contracts.ts";

interface Props {
  resource: GardenNavigationResource;
}

function gardenHref(slug: string): string {
  return `/garden/${encodeURIComponent(slug)}`;
}

function pageHref(gardenSlug: string, pageSlug: string): string {
  return `${gardenHref(gardenSlug)}?note=${encodeURIComponent(pageSlug)}`;
}

export default function GardenNavigator({ resource }: Props) {
  const canOpenGarden = resource.actions.includes("open-garden");
  const canOpenPage = resource.actions.includes("open-page");

  return (
    <section
      className="my-4 overflow-hidden rounded-2xl bg-[var(--paper-raised)] shadow-[0_1px_2px_rgba(41,55,47,0.06),0_0_0_1px_var(--line)]"
      aria-label={resource.title}
      data-generative-ui="garden-navigator"
    >
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--botanical)_12%,transparent)] text-[var(--botanical)]">
          <Sprout className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--ink-heading)]">
            {resource.title}
          </h3>
          <p className="truncate text-[11px] text-[var(--ink-muted)]">
            {resource.data.query}
          </p>
        </div>
      </header>

      <div className="grid gap-px bg-[var(--line)]">
        {resource.data.gardens.map((garden) => (
          <article key={garden.slug} className="bg-[var(--paper-raised)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">
                  {garden.name}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                  {garden.results.length} relevant {garden.results.length === 1 ? "note" : "notes"}
                </p>
              </div>
              {canOpenGarden ? (
                <LinkContextMenu
                  href={gardenHref(garden.slug)}
                  label={`Open ${garden.name}`}
                >
                  <a
                    href={gardenHref(garden.slug)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[var(--botanical)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--botanical)_10%,transparent)] active:scale-[0.97]"
                  >
                    Open Garden
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </LinkContextMenu>
              ) : null}
            </div>

            <ul className="mt-2 grid gap-1">
              {garden.results.map((result) => (
                <li key={result.pageSlug}>
                  {canOpenPage ? (
                    <LinkContextMenu
                      href={pageHref(garden.slug, result.pageSlug)}
                      label={`Open ${result.title}`}
                    >
                      <a
                        href={pageHref(garden.slug, result.pageSlug)}
                        className="group flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--paper-strong)]"
                      >
                        <BookOpen className="mt-0.5 size-3.5 shrink-0 text-[var(--ink-muted)] transition-colors group-hover:text-[var(--botanical)]" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-[var(--ink)]">
                            {result.title}
                          </span>
                          {result.heading || result.excerpt ? (
                            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-[var(--ink-muted)]">
                              {result.heading ?? result.excerpt}
                            </span>
                          ) : null}
                        </span>
                      </a>
                    </LinkContextMenu>
                  ) : (
                    <span className="block px-2 py-1.5 text-[12px] text-[var(--ink)]">
                      {result.title}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
