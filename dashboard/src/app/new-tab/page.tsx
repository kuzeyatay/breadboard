import type { Metadata } from "next";
import DashboardPageShell from "@/app/dashboard/dashboard-page-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terminal — breadboard" };

/** The shared home keeps the original gardens, terminal, and browser widgets live. */
export default async function NewTabPage({ searchParams }: {
  searchParams: Promise<{ terminalChat?: string | string[] }>;
}) {
  const requested = await searchParams;
  const initialTerminalChatId = Array.isArray(requested.terminalChat)
    ? requested.terminalChat[0] ?? null : requested.terminalChat ?? null;
  return <DashboardPageShell combinedHome initialTerminalChatId={initialTerminalChatId} />;
}
