import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import BackLink from "@/app/components/back-link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import BrainMapPanel from "../profile/brain-map-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  icons: { icon: "/knowledge-map.svg" },
  title: "Knowledge — breadboard",
  description: "How the ideas in your Gardens are organized and connected.",
};

/** The Knowledge map, on its own page (it used to be a tab of Settings). */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[]; organization?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/knowledge");
  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=/knowledge");

  const requested = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const organization = first(requested.organization);
  const initialScope =
    first(requested.scope) === "organization" && organization ? organization.slice(0, 320) : "all";

  return (
    <div data-hide-scrollbars className="flex min-h-screen flex-col bg-[var(--paper-bg)] text-white">
      <header className="breadboard-flower-navbar relative flex shrink-0 items-center justify-between gap-4 border-b border-gray-800 px-6 py-3.5">
        <NavbarFlowerWind showFlowers={getNavbarFlowers(userId)} />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <BackLink fallbackHref="/new-tab" fallbackLabel="Back to home" />
          <span className="text-gray-700">/</span>
          <h1 className="truncate text-sm font-semibold text-white">Knowledge</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5 sm:py-6">
        <BrainMapPanel initialScope={initialScope} />
      </main>
    </div>
  );
}
