import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth-options";
import MarkdownToPdfButton from "@/app/components/markdown-to-pdf-button";
import NewNoteButton from "@/app/components/new-note-button";
import { quartzUrl } from "@/lib/quartz-url";
import {
  refreshPrivateQuartzIndex,
  refreshPublicQuartzIndex,
} from "@/lib/quartz-garden-index";
import LibraryGardenClient from "./library-garden-client";

type QuartzView = "private" | "public";

function switchClass(active: boolean): string {
  return active
    ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-gray-950 shadow-sm"
    : "rounded-md px-3 py-1.5 text-xs font-semibold text-gray-400 transition hover:text-white";
}

export default async function GardenHomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string }).id);
  const { view: rawView } = await searchParams;
  const view: QuartzView = rawView === "public" ? "public" : "private";

  const quartzSlug =
    view === "public"
      ? refreshPublicQuartzIndex()
      : refreshPrivateQuartzIndex(userId);

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="text-gray-500 hover:text-white transition-colors text-sm flex items-center gap-1.5 shrink-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
            Back to dashboard
          </Link>
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-semibold text-white truncate max-w-xs">
            {view === "public" ? "Public library" : "My library"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {view === "private" && <NewNoteButton />}
          <MarkdownToPdfButton label="Save PDF" />
          <nav
            aria-label="Library visibility"
            className="inline-flex items-center rounded-md border border-gray-800 bg-gray-900/80 p-1 shadow-inner"
          >
            <Link
              href="/garden?view=private"
              aria-current={view === "private" ? "page" : undefined}
              className={switchClass(view === "private")}
            >
              My library
            </Link>
            <Link
              href="/garden?view=public"
              aria-current={view === "public" ? "page" : undefined}
              className={switchClass(view === "public")}
            >
              Public Library
            </Link>
          </nav>
        </div>
      </header>

      <LibraryGardenClient
        src={quartzSlug ? quartzUrl(quartzSlug) : quartzUrl()}
        title={view === "public" ? "Public library" : "My library"}
      />
    </div>
  );
}
