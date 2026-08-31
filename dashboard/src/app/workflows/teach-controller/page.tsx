// The floating recording controller.
//
// The desktop shell opens this page in a small always-on-top window while a
// demonstration is being recorded, so the indicator, the elapsed time and the
// Finish button stay reachable while the person works in another application.
//
// It is a control surface only. The tab that opened the session is holding the
// microphone, so this window asks it to act rather than acting itself -- the
// narration has to be stopped and uploaded by whoever is recording it.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth-options";

import TeachControllerClient from "./teach-controller-client";

export const dynamic = "force-dynamic";

export default async function TeachControllerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=%2Fworkflows");
  const params = await searchParams;
  const sessionId = typeof params.session === "string" ? params.session : null;
  if (!sessionId) redirect("/workflows");
  return <TeachControllerClient sessionId={sessionId} />;
}
