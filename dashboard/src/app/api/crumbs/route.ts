import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin.ts";
import { crumbs, crumbsErrorResponse, orgListener } from "@/lib/crumbs/service.ts";
import { AnnotationError, browserAnnotationMine } from "@/lib/browser-annotations-store.ts";
import db from "@/lib/db";

export const dynamic = "force-dynamic";
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
const failure = (error: unknown) => error instanceof AnnotationError ? Response.json({ error: error.message }, { status: error.status }) : crumbsErrorResponse(error) ?? apiErrorResponse(error);

/** The browser-facing origin, so the sign-in redirect comes back to this same server. */
function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${url.protocol}//${host}`;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const query = new URL(request.url).searchParams;
    switch (query.get("view")) {
      case "status": return json(crumbs.status(userId));
      case "ai-flags": return json(await crumbs.aiFlags(userId, query.get("url")));
      case "typeahead": return json({ people: await crumbs.typeahead(query.get("q")) });
      case "feed": {
        const scope = query.get("scope") ?? "following";
        const page = await crumbs.feed(userId, scope, query.get("before"));
        if (scope !== "mine" || query.get("before")) return json(page);
        // Mine is everything this account wrote, wherever it was left: the network's crumbs, and the ones kept here.
        const items = [...page.items, ...browserAnnotationMine(db, userId)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        return json({ ...page, items });
      }
      case "organizations": {
        // Crumbs organizations: encrypted on the network, readable by their members anywhere.
        const remote = crumbs.status(userId).signedIn ? await crumbs.listOrgs(userId).catch(() => []) : [];
        return json({ organizations: remote.map(org => ({ name: org.name, scope: `org:${org.id}` })) });
      }
      case "follows": return json(await crumbs.follows(userId));
      // What people you follow highlighted on the page the browser has open.
      case "page-follows": return json(await crumbs.followedOnPage(userId, query.get("url")));
      case "orgs": return json({ orgs: await crumbs.listOrgs(userId) });
      case "org": return json(await crumbs.orgDetail(userId, query.get("id") ?? ""));
      case "notes": return json(await crumbs.listNotes(userId, query.get("id")));
      case "rooms": return json({ rooms: await crumbs.listRooms(userId, query.get("id") ?? "") });
      case "chat": return json(await crumbs.readChat(userId, query.get("id") ?? "", query.get("room"), query.get("after")));
      default: return Response.json({ error: "Unknown view." }, { status: 400 });
    }
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "Use Crumbs from Breadboard.");
    const userId = await requireUserId();
    const body = await readJsonBody(request, 32_000);
    const org = String(body.org ?? "");
    switch (body.action) {
      case "feed-preference": crumbs.setFeedPreference(userId, body.enabled); return json(crumbs.status(userId));
      case "feed-feedback": crumbs.feedFeedback(userId, body); return json({ ok: true });
      case "sign-in": return json(await crumbs.startSignIn(userId, { handle: body.handle, signup: body.signup === true, origin: requestOrigin(request), returnTo: body.returnTo }));
      case "sign-out": orgListener.stop(userId); await crumbs.signOut(userId); return json(crumbs.status(userId));
      case "ai-flag": return json(await crumbs.aiFlag(userId, body.url, body.on));
      case "follow": return json(await crumbs.follow(userId, body.who, body.on !== false));
      case "delete": await crumbs.deleteMine(userId, body.id); return json({ deleted: true });
      case "handle": return json(await crumbs.claimHandle(userId, body.name));
      case "org-create": return json(await crumbs.createOrg(userId, body.name));
      case "org-add": return json(await crumbs.addOrgMember(userId, org, body.who, body.role));
      case "org-remove": return json(await crumbs.removeOrgMember(userId, org, body.did));
      case "org-leave": await crumbs.leaveOrg(userId, org); return json({ left: true });
      case "org-delete": await crumbs.deleteOrg(userId, org); return json({ deleted: true });
      case "note-add": return json(await crumbs.addNote(userId, body.id, body.body, body.source));
      case "note-delete": return json(await crumbs.deleteNote(userId, body.id, body.note));
      case "note-rate": return json(await crumbs.rateNote(userId, body.id, body.note, body.helpful));
      case "room-create": return json({ rooms: await crumbs.createRoom(userId, org, body.name) });
      case "room-delete": return json({ rooms: await crumbs.deleteRoom(userId, org, body.room) });
      case "chat-send": return json(await crumbs.sendChat(userId, org, body.room, body.body));
      case "chat-delete": await crumbs.deleteChat(userId, org, body.message); return json({ deleted: true });
      case "chat-report": await crumbs.reportChat(userId, org, body.message, body.reason); return json({ reported: true });
      case "org-dismiss-report": return json(await crumbs.dismissOrgReport(userId, org, body.report));
      case "ai": return json(await crumbs.ai(userId, body));
      default: return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) { return failure(error); }
}
