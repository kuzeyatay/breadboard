import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import WorkflowsClient from "./workflows-client";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=%2Fworkflows");
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? params[key] : null);
  return (
    <WorkflowsClient
      workflowId={value("workflow")}
      teachOnOpen={value("teach") === "1"}
      initialRunId={value("run")}
    />
  );
}
