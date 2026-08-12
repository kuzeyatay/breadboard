import type { Metadata } from "next";
import DashboardPageShell from "@/app/dashboard/dashboard-page-shell";

export const metadata: Metadata = {
  title: "Hooks — breadboard",
  description: "Create automations that react when something happens.",
};

export default function HooksPage() {
  return <DashboardPageShell initialTerminalPanel="hooks" />;
}
