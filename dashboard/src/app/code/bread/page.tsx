import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import DashboardAgentTerminal from "@/app/components/hermes/dashboard-agent-terminal";
import db from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bread — breadboard", description: "Bread inside the Code tab's VS Code." };

/** Bread's chat as VS Code's Bread view shows it (loaded through the Bread extension's proxy). */
export default async function CodeBreadPage({ searchParams }: { searchParams: Promise<{ garden?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/code/bread");
  // The Garden whose repository VS Code has open: chats start in its workspace,
  // so they also appear in that Garden's chats.
  const slug = (await searchParams).garden?.trim();
  const userId = Number((session.user as { id?: string }).id);
  const workspace = slug
    ? db.prepare("SELECT slug, name FROM clusters WHERE slug = ? AND user_id = ?").get(slug, userId) as { slug: string; name: string } | undefined
    : undefined;
  // The drawer surface positions itself against its panel, as in the browser rail.
  return <div style={{ position: "relative", height: "100dvh", overflow: "hidden", background: "var(--paper-surface)" }}>
    <div className="browser-tool-panel browser-tool-panel-terminal" data-active="true">
      <DashboardAgentTerminal scope="mine" restoreOwnerKey="code" presentation="drawer" initialWorkspace={workspace ?? null} />
    </div>
  </div>;
}
