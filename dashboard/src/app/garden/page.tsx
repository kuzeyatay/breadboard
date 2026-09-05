import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth-options";
import BackLink from "@/app/components/back-link";
import MarkdownToPdfButton from "@/app/components/markdown-to-pdf-button";
import NewNoteButton from "@/app/components/new-note-button";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import LinkContextMenu from "@/app/components/link-context-menu";
import { quartzUrl } from "@/lib/quartz-url";
import {
  prepareOrganizationQuartzIndex,
  preparePrivateClusterQuartzIndex,
  preparePrivateQuartzIndex,
  preparePublicQuartzIndex,
} from "@/lib/quartz-garden-index";
import {
  publishQuartzAfterMutation,
  waitForQuartzPublicationInFlight,
} from "@/lib/quartz-publish";
import { openQuartzViewLease } from "@/lib/quartz-view-lease";
import { organizationIdsForUser } from "@/lib/organizations/store";
import { getNavbarFlowers } from "@/lib/profile/navbar-shortcuts-store.ts";
import LibraryGardenClient from "./library-garden-client";

type QuartzView = "private" | "organization" | "public";

const VIEW_TITLES: Record<QuartzView, string> = {
  private: "My garden",
  organization: "Organization garden",
  public: "Public garden",
};

function switchClass(active: boolean): string {
  return active
    ? "rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950 shadow-sm"
    : "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-white";
}

export default async function GardenHomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; cluster?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string }).id);
  const { view: rawView, cluster: rawCluster } = await searchParams;
  const inOrganization = organizationIdsForUser(userId).length > 0;
  const view: QuartzView =
    rawView === "public"
      ? "public"
      : rawView === "organization" && inOrganization
        ? "organization"
        : "private";

  const prepareRequestedIndex = () => {
    const scopedPrivateIndex =
      view === "private" && rawCluster
        ? preparePrivateClusterQuartzIndex(userId, rawCluster)
        : null;
    return (
      scopedPrivateIndex ??
      (view === "public"
        ? preparePublicQuartzIndex()
        : view === "organization"
          ? prepareOrganizationQuartzIndex(userId)
          : preparePrivateQuartzIndex(userId))
    );
  };
  let preparedIndex = prepareRequestedIndex();

  // The library index is generated on demand. Do not hand the iframe a slug
  // that the currently published Quartz tree does not contain yet: keeping
  // this await inside the Server Component leaves navigation feedback with the
  // one global blue progress bar and prevents Quartz's temporary 404 document
  // from becoming the visible garden.
  if (preparedIndex?.publishRequired) {
    // Dashboard entry pre-warms every cluster index. If that publication is
    // already running, let it finish and check the exact output before asking
    // Runtime V2 for another full-site build.
    if (await waitForQuartzPublicationInFlight()) {
      preparedIndex = prepareRequestedIndex();
    }
    if (preparedIndex?.publishRequired) {
      await publishQuartzAfterMutation(`refresh ${view} garden index`, {
        userId,
        requireSuccess: true,
        topologyImpact: "none",
      });
    }
  }

  // Same reasoning for the view lease: taking it here keeps the frame from
  // ever rendering its own loading state.
  const quartzViewId = await openQuartzViewLease(userId);

  const quartzSlug = preparedIndex?.slug ?? null;
  const viewTitle = preparedIndex?.title ?? VIEW_TITLES[view];

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      <header className="breadboard-flower-navbar relative flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-800 shrink-0">
        <NavbarFlowerWind showFlowers={getNavbarFlowers(userId)} />
        <div className="relative z-10 flex items-center gap-3 min-w-0">
          <BackLink fallbackHref="/dashboard" fallbackLabel="Back to dashboard" />
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-semibold text-white truncate max-w-xs">
            {viewTitle}
          </h1>
        </div>
        <div className="relative z-10 flex items-center gap-2">
          {view === "private" && <NewNoteButton />}
          <MarkdownToPdfButton label="Save PDF" />
          <nav
            aria-label="Library visibility"
            className="inline-flex items-center rounded-md border border-gray-800 bg-gray-900/80 p-1 shadow-inner"
          >
            <LinkContextMenu href="/garden?view=private" label="My garden">
              <Link
                href="/garden?view=private"
                aria-current={view === "private" ? "page" : undefined}
                className={switchClass(view === "private")}
              >
                My garden
              </Link>
            </LinkContextMenu>
            <LinkContextMenu href="/garden?view=public" label="Public garden">
              <Link
                href="/garden?view=public"
                aria-current={view === "public" ? "page" : undefined}
                className={switchClass(view === "public")}
              >
                Public garden
              </Link>
            </LinkContextMenu>
            {inOrganization && (
              <LinkContextMenu
                href="/garden?view=organization"
                label="Organization garden"
              >
                <Link
                  href="/garden?view=organization"
                  aria-current={view === "organization" ? "page" : undefined}
                  className={switchClass(view === "organization")}
                >
                  Organization
                </Link>
              </LinkContextMenu>
            )}
          </nav>
        </div>
      </header>

      <LibraryGardenClient
        src={quartzSlug ? quartzUrl(quartzSlug) : quartzUrl()}
        title={viewTitle}
        quartzViewId={quartzViewId}
      />
    </div>
  );
}
