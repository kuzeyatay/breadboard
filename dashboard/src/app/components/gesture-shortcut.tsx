"use client";

import { Hand } from "lucide-react";
import NavigationLink from "./navigation-link";

export default function GestureShortcut({ className }: { className?: string }) {
  return <NavigationLink href="/gestures" label="Gestures" className={className} prefetch={false} title="Open gesture control">
    <Hand size={15} aria-hidden="true" />
    Gestures
  </NavigationLink>;
}
