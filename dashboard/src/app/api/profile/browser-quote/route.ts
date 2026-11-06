import db from "@/lib/db";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-core";
import { validBrowserQuoteChoice } from "@/app/browser/browser-daily-quotes";
import { readBrowserQuoteChoice, writeBrowserQuoteChoice } from "@/lib/browser-quote-store";

export const dynamic = "force-dynamic";
async function owner(request: Request) {
  const userId = await requireUserId();
  const user = db.prepare("SELECT email FROM users WHERE id=?").get(userId) as {email: string} | undefined;
  const key = new URL(request.url).searchParams.get("ownerKey")?.trim().toLowerCase();
  if (!key || !user || ![String(userId),user.email.trim().toLowerCase()].includes(key)) throw new RouteError(403,"Your account changed. Reload before choosing a quote.");
  return userId;
}
export async function GET(request: Request) {
  try { return Response.json({choice: readBrowserQuoteChoice(db,await owner(request))}, {headers:{"Cache-Control":"no-store"}}); }
  catch (error) { return routeErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await owner(request);
    const body = await readJsonBody(request,2048);
    if (!validBrowserQuoteChoice(body.choice)) throw new RouteError(400,"Choose a valid quote.");
    return Response.json({choice: writeBrowserQuoteChoice(db,userId,body.choice)}, {headers:{"Cache-Control":"no-store"}});
  } catch (error) { return routeErrorResponse(error); }
}
