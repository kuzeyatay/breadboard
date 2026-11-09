"use client";
import { ChartNoAxesColumn } from "lucide-react";
import NavigationLink from "./navigation-link";

export default function ScreenTimeShortcut({ className }: { className?: string }) {
  return <NavigationLink href="/screen-time" label="Screen Time" className={className} prefetch={false} title="See your apps, tabs and time">
    <ChartNoAxesColumn size={15} aria-hidden="true" />Screen Time
  </NavigationLink>;
}
