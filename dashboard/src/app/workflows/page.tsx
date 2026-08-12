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
  const value = (key: string) => typeof params[key] === "string" ? params[key] : null;
  const template = Number(value("template"));
  return (
    <WorkflowsClient
      mode={value("mode") === "new" ? "new" : "home"}
      templateId={Number.isInteger(template) && template > 0 ? template : null}
      workflowId={value("workflow")}
    />
  );
}
