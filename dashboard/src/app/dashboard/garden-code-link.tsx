"use client";

import NavigationLink from "@/app/components/navigation-link";
import VSCodeIcon from "@/app/components/vscode-icon";

export default function GardenCodeLink({ slug, name }: { slug: string; name: string }) {
  return <NavigationLink
    href={`/code?garden=${encodeURIComponent(slug)}`}
    label={`Open ${name} repository in Code`}
    newTab
    prefetch={false}
    data-card-action="true"
    className="bb-garden-card-action flex w-full items-center justify-center gap-2 rounded-lg py-2 text-center text-sm font-medium"
  >
    <VSCodeIcon size={16} />
    Open repo in Code
  </NavigationLink>;
}
