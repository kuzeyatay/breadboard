import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { Monitor } from "lucide-react";
import BackLink from "@/app/components/back-link";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import GestureScreen from "./gesture-screen";

export const metadata: Metadata = { title: "Gestures · Breadboard" };

export default async function GesturesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=%2Fgestures");
  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=%2Fgestures");

  return <>
    <header className="breadboard-flower-navbar relative flex shrink-0 items-center justify-between gap-4 border-b border-gray-800 px-6 py-3.5">
      <NavbarFlowerWind showFlowers={getNavbarFlowers(userId)} />
      <div className="relative z-10 flex min-w-0 items-center gap-3">
        <BackLink fallbackHref="/new-tab" fallbackLabel="Back to home" />
        <span className="text-gray-700" aria-hidden="true">/</span>
        <span className="truncate text-sm font-semibold text-white">Gestures</span>
      </div>
      <span className="relative z-10 hidden shrink-0 items-center gap-2 text-xs text-gray-500 sm:inline-flex"><Monitor size={14} /> External monitor only</span>
    </header>
    <GestureScreen />
  </>;
}
