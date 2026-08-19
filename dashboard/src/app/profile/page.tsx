import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";
import { browserProfileState } from "@/lib/agent-browser/service.ts";
import { getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";
import { readProfileStats } from "@/lib/profile/stats.ts";
import { getContactStore } from "@/lib/contacts/instance.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { caldavVaultConfigured } from "@/lib/calendar/caldav-credentials.ts";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile — breadboard",
  description: "Your account, your habit, and the invites you have handed out.",
};

/**
 * The page behind the profile chip in the navbar.
 *
 * The stats are read on the server in one pass: they come from half a dozen
 * tables and none of them are worth a client round-trip, since nothing on this
 * page changes while you are looking at it. Inviting is the exception, and the
 * client owns that on its own.
 */
export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/profile");

  const userId = Number((session.user as { id?: string }).id);
  if (!Number.isFinite(userId) || userId <= 0) redirect("/auth/login?callbackUrl=/profile");

  const stats = readProfileStats(db, userId);

  // The address book and the synced calendars are two more small local reads,
  // so they join the same pass rather than each costing the panel a round trip
  // and a loading flash.
  const contacts = getContactStore();
  const calendars = getCalendarStore()
    .listCalendars(userId)
    .filter((calendar) => calendar.caldavUrl);

  return (
    <ProfileClient
      stats={stats}
      initialShortcuts={getNavbarShortcuts(userId)}
      browserProfile={browserProfileState()}
      contacts={contacts.listContacts(userId, { limit: 200 })}
      contactTotal={contacts.countContacts(userId)}
      syncedCalendars={calendars}
      calendarVaultConfigured={caldavVaultConfigured()}
    />
  );
}
