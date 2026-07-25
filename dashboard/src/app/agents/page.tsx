import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import AgentsClient from "./agents-client";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");
  const email = session.user.email ?? "";
  const username = session.user.name ?? email;
  return <AgentsClient email={email} username={username} />;
}
