"use client";

import { LayoutGrid } from "lucide-react";
import KnowledgeIcon from "./knowledge-icon";
import NavigationLink from "./navigation-link";

export default function OfficeShortcut({ className }: { className?: string }) {
  return <NavigationLink href="/spaces" label="Spaces" className={className} prefetch={false} title="Docs, sheets, slides, pages, whiteboards, designs and videos">
    <LayoutGrid size={15} aria-hidden="true" />
    Spaces
  </NavigationLink>;
}

/** The Knowledge map; sits right after Spaces among the Terminal shortcuts. */
export function KnowledgeShortcut({ className }: { className?: string }) {
  return <NavigationLink href="/knowledge" label="Knowledge" className={className} prefetch={false} title="How the ideas in your Gardens are organized and connected">
    <KnowledgeIcon size={15} />
    Knowledge
  </NavigationLink>;
}
