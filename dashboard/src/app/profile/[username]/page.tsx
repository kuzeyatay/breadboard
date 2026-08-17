import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Someone else's profile is a popup now, not a screen of its own. Old links —
 * and anyone who typed the address — land on the dashboard with that popup
 * already open, rather than on a page that no longer exists.
 */
export default async function PersonProfileRedirect({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  redirect(`/dashboard?person=${encodeURIComponent(decodeURIComponent(username))}`);
}
