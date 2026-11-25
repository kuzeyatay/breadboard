import type { Metadata } from "next";
import DashboardPageShell from "@/app/dashboard/dashboard-page-shell";

export const metadata: Metadata = {
  title: "Scheduled — breadboard",
  description: "See and manage your scheduled tasks.",
};

export default function ScheduledPage() {
  return <DashboardPageShell initialTerminalPanel="scheduled" />;
}
