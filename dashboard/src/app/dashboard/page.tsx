import DashboardPageShell from "./dashboard-page-shell";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ terminalChat?: string | string[] }>;
}) {
  const requested = await searchParams;
  const initialTerminalChatId = Array.isArray(requested.terminalChat)
    ? requested.terminalChat[0] ?? null
    : requested.terminalChat ?? null;
  return (
    <DashboardPageShell
      initialTerminalPanel={null}
      initialTerminalChatId={initialTerminalChatId}
    />
  );
}
