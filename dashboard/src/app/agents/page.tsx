import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import AgentsClient from "./agents-client";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");
  const username = session.user.name ?? session.user.email ?? "";
  return <AgentsClient username={username} />;
}
