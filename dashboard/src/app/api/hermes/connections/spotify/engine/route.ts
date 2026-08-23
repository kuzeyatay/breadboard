import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { spotifyBrowserAccessToken } from "@/lib/spotify/service.ts";
import {
  ensureSpotifyPlaybackEngine,
  registerSpotifyPlaybackEngine,
  verifySpotifyEngineTicket,
} from "@/lib/spotify/playback-engine.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function enginePage(endpoint: string, ticket: string): string {
  const safeEndpoint = JSON.stringify(endpoint);
  const safeTicket = JSON.stringify(ticket);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Breadboard Spotify Player</title></head>
<body>
<script>
const endpoint=${safeEndpoint};
const ticket=${safeTicket};
let deviceId=null;
async function register(){
  if(!deviceId)return;
  await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket,deviceId}),cache:"no-store"}).catch(()=>{});
}
window.onSpotifyWebPlaybackSDKReady=()=>{
  const player=new Spotify.Player({
    name:"Breadboard",
    volume:0.7,
    getOAuthToken:callback=>{
      const url=new URL(endpoint);url.searchParams.set("mode","token");url.searchParams.set("ticket",ticket);
      fetch(url,{cache:"no-store"}).then(response=>response.json()).then(payload=>callback(payload.accessToken));
    }
  });
  player.addListener("ready",value=>{deviceId=value.device_id;void register();});
  player.addListener("not_ready",()=>{deviceId=null;});
  player.connect();
  setInterval(()=>void register(),5000);
};
</script>
<script src="https://sdk.scdn.co/spotify-player.js"></script>
</body></html>`;
}

export async function GET(request: Request) {
  try {
    requireEnabled();
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "status";
    if (mode === "page") {
      const ticket = url.searchParams.get("ticket") ?? "";
      verifySpotifyEngineTicket(ticket);
      return new NextResponse(enginePage(url.origin + url.pathname, ticket), {
        headers: {
          ...noStoreHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (mode === "token") {
      const ticket = url.searchParams.get("ticket") ?? "";
      const userId = verifySpotifyEngineTicket(ticket);
      return NextResponse.json(await spotifyBrowserAccessToken(userId), {
        headers: noStoreHeaders,
      });
    }
    const userId = await requireUserId();
    return NextResponse.json(ensureSpotifyPlaybackEngine(userId, url.origin), {
      headers: noStoreHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireEnabled();
    const body = await readJsonBody(request, 4 * 1024);
    registerSpotifyPlaybackEngine({
      ticket: typeof body.ticket === "string" ? body.ticket : "",
      deviceId: body.deviceId,
    });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
