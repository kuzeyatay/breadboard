import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import WorkflowsClient from "./workflows-client";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=%2Fworkflows");
  const userId = Number((session.user as { id?: string }).id);
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? params[key] : null);
  return (
    <WorkflowsClient
      workflowId={value("workflow")}
      clapReview={value("clapReview") === "1"}
      teachOnOpen={value("teach") === "1"}
      initialRunId={value("run")}
      showNavbarFlowers={getNavbarFlowers(userId)}
    />
  );
}
