import type { Metadata } from "next";
import DashboardPageShell from "@/app/dashboard/dashboard-page-shell";

export const metadata: Metadata = {
  title: "Processes — breadboard",
  description: "See active chats, running work, scheduled tasks, and hooks.",
};

export default function ProcessesPage() {
  return <DashboardPageShell initialTerminalPanel="processes" />;
}
