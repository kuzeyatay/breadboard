import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { requireSameOrigin } from "@/lib/request-origin.ts";
import { buzzBridge, crumbs, crumbsErrorResponse } from "@/lib/crumbs/service.ts";
import { AnnotationError, browserAnnotationFeed, browserAnnotationMine } from "@/lib/browser-annotations-store.ts";
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
      case "typeahead": return json({ people: await crumbs.typeahead(query.get("q")) });
      case "feed": {
        const scope = query.get("scope") ?? "following";
        // A Breadboard organization's crumbs live in its crumbs room on this machine, not on the network.
        if (scope.startsWith("room:")) return json({ items: browserAnnotationFeed(db, userId, scope), before: null });
        const page = await crumbs.feed(userId, scope, query.get("before"));
        if (scope !== "mine" || query.get("before")) return json(page);
        // Mine is everything this account wrote, wherever it was left: the network's crumbs, and the ones kept here.
        const items = [...page.items, ...browserAnnotationMine(db, userId)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        return json({ ...page, items });
      }
      case "follows": return json(await crumbs.follows(userId));
      case "orgs": return json({ orgs: (await crumbs.listOrgs(userId)).map(org => ({ ...org, crumbsRoom: buzzBridge.crumbsRoomOf(userId, org.id) })), local: buzzBridge.localOrganizations(userId) });
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
      case "sign-in": return json(await crumbs.startSignIn(userId, { handle: body.handle, signup: body.signup === true, origin: requestOrigin(request), returnTo: body.returnTo }));
      case "sign-out": await crumbs.signOut(userId); return json(crumbs.status(userId));
      case "visibility": crumbs.setDefaultVisibility(userId, body.value); return json(crumbs.status(userId));
      case "servers": crumbs.setServers({ indexer: body.indexer, orgStore: body.orgStore, publicMode: body.publicMode }); return json(crumbs.status(userId));
      case "follow": return json(await crumbs.follow(userId, body.who, body.on !== false));
      case "delete": await crumbs.deleteMine(userId, body.id); return json({ deleted: true });
      case "handle": return json(await crumbs.claimHandle(userId, body.name));
      case "org-create": return json(await crumbs.createOrg(userId, body.name));
      case "org-connect": await buzzBridge.connectOrganization(userId, Number(body.organization)); return json({ connected: true });
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
