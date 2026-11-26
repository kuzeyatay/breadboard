import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import { readProfileStatsCached } from "@/lib/profile/stats.ts";
import { getContactStore } from "@/lib/contacts/instance.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { caldavVaultConfigured } from "@/lib/calendar/caldav-credentials.ts";
import ProfileClient from "./profile-client";
import { readClapAction } from "@/lib/profile/clap-action-store.ts";
import { askPasswordAtStartup } from "@/lib/first-account";
import { thoughtTopologyAutoUpdateEnabled, webPdfCleanupEnabled } from "@/lib/thought-topology/preferences.ts";
import { intermediateResponsesEnabled } from "@/lib/hermes/intermediate-responses.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings — breadboard",
  description: "Your account, download preferences, and Breadboard settings.",
};

/**
 * Settings for the local account.
 *
 * The stats are read on the server in one pass: they come from half a dozen
 * tables and none of them are worth a client round-trip, since nothing on this
 * page changes while you are looking at it. Inviting is the exception, and the
 * client owns that on its own.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    scope?: string | string[];
    organization?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const requested = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const rawTab = first(requested.tab);
  const returnTo = first(requested.returnTo);
  if (rawTab === "recall") {
    const query = new URLSearchParams({ tab: "recall" });
    if (returnTo) query.set("returnTo", returnTo);
    redirect(`/screen-time?${query}`);
  }
  // Knowledge has its own page now; old `?tab=knowledge` (and `?tab=brain`)
  // links land there with their scope.
  if (rawTab === "knowledge" || rawTab === "brain") {
    const query = new URLSearchParams();
    const scope = first(requested.scope);
    const organization = first(requested.organization);
    if (scope) query.set("scope", scope);
    if (organization) query.set("organization", organization);
    redirect(query.size ? `/knowledge?${query}` : "/knowledge");
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/settings");

  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=/settings");

  const stats = readProfileStatsCached(db, userId);

  // The address book and the synced calendars are two more small local reads,
  // so they join the same pass rather than each costing the panel a round trip
  // and a loading flash.
  const contacts = getContactStore();
  const calendars = getCalendarStore()
    .listCalendars(userId)
    .filter((calendar) => calendar.sourceUrl || calendar.caldavUrl || calendar.googleCalendarId);
  return (
    <ProfileClient
      stats={stats}
      returnTo={returnTo}
      initialThoughtTopologyAutoUpdate={thoughtTopologyAutoUpdateEnabled(userId)}
      initialWebPdfCleanup={webPdfCleanupEnabled(userId)}
      initialIntermediateResponses={intermediateResponsesEnabled(userId)}
      initialAskPasswordAtStartup={askPasswordAtStartup(userId)}
      initialClapAction={readClapAction(db, userId)}
      initialSnapAction={readClapAction(db, userId, 'snap')}
      clapActionUserId={String(userId)}
      initialShortcuts={getNavbarShortcuts(userId)}
      initialNavbarFlowers={getNavbarFlowers(userId)}
      contacts={contacts.listContacts(userId, { limit: 200 })}
      contactTotal={contacts.countContacts(userId)}
      syncedCalendars={calendars}
      calendarVaultConfigured={caldavVaultConfigured()}
    />
  );
}
