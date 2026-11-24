import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import BackLink from "@/app/components/back-link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import SettingsSectionNav from "@/app/components/settings-section-nav";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import ScreenTimeScreen from "./screen-time-screen";

export const metadata: Metadata = { title: "Screen Time · Breadboard" };
export default async function ScreenTimePage({ searchParams }: {
  searchParams: Promise<{ tab?: string | string[]; returnTo?: string | string[] }>;
}) {
  const { tab, returnTo } = await searchParams;
  const openRecallSettings = (Array.isArray(tab) ? tab[0] : tab) === "recall";
  const login = `/auth/login?${new URLSearchParams({ callbackUrl: openRecallSettings ? "/screen-time?tab=recall" : "/screen-time" })}`;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(login);
  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect(login);

  return <>
    <header className="breadboard-flower-navbar relative flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-3 py-3.5 sm:gap-4 sm:px-6">
      <NavbarFlowerWind showFlowers={getNavbarFlowers(userId)} />
      <div className="relative z-10 flex min-w-0 items-center gap-3">
        <BackLink fallbackHref="/new-tab" fallbackLabel="Back to home" />
        <span className="text-gray-700" aria-hidden="true">/</span>
        <span className="truncate text-sm font-semibold text-white">Screen Time</span>
      </div>
      <SettingsSectionNav active="/screen-time" returnTo={Array.isArray(returnTo) ? returnTo[0] : returnTo} />
    </header>
    <ScreenTimeScreen initialRecallSettingsOpen={openRecallSettings} />
  </>;
}
