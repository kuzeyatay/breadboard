import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Exercise the real Spotify service and HTTP broker, replacing only credentials,
// persistence, and network I/O. No Spotify account or playback is modified.
const fixture = `
  export const credentials = new Map();
  export function readConnectedAppTokens(userId) {
    return {accessToken: credentials.get(userId) ?? 'fixture-' + userId,
      expiresAt:'2099-01-01T00:00:00Z',tokenType:'Bearer',raw:{},
      scope:'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private playlist-modify-private'};
  }
  export function storeConnectedAppTokens() { throw Error('Unexpected credential write'); }
`;
const stubs = {
  "server-only": "export {};",
  "test-fixture": fixture,
  "../db.ts": "export default {};",
  "./vault.ts": "export * from 'test-fixture';",
  "../connected-apps/vault.ts": "export * from 'test-fixture';",
  "../hermes/route-core.ts": `export class ApiError extends Error {
    constructor(status,code,message){super(message);this.status=status;this.code=code;}
  }`,
  "../nango/catalog.ts": `
    export const findNangoIntegration=slug=>({slug,name:slug});
    export const connectedAppOAuthMetadata=()=>({baseUrl:'https://api.spotify.test',proxyHeaders:{}});
  `,
};
const bundle = await build({
  stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts", contents: `
    export * from './src/lib/spotify/service.ts';
    export {embeddedProviderRequest} from './src/lib/connected-apps/broker.ts';
    export {credentials} from 'test-fixture';
  ` },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "spotify-library-fixture", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path)
      ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});
const spotify = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const ownedId = "0123456789abcdefghijAB";
const followedId = "0123456789abcdefghijAC";
const collaborativeId = "0123456789abcdefghijAD";
const playlist = (id, owner, collaborative = false) => ({
  id, uri: `spotify:playlist:${id}`, name: id, owner: { id: owner, display_name: owner },
  items: { total: 2 }, public: false, collaborative,
});
const track = { id: ownedId, uri: `spotify:track:${ownedId}`, name: "Song",
  artists: [{ name: "Artist" }], album: { name: "Album", images: [] }, duration_ms: 120000 };

test("catalog search validates artists, tolerates missing portraits, and preserves song-only searches", async t => {
  const requests = [];
  const artist = {id:ownedId,uri:`spotify:artist:${ownedId}`,name:"  Artist  ",images:[{url:"https://i.scdn.co/image/portrait"}]};
  t.mock.method(globalThis, "fetch", async input => {
    requests.push(new URL(input));
    return Response.json({tracks:{items:[track]},artists:{items:[
      artist, null, {...artist,id:"bad"}, {...artist,uri:track.uri}, {...artist,name:" "},
      {...artist,id:followedId,uri:`spotify:artist:${followedId}`,images:[{url:"https://example.com/portrait"}]},
    ]}});
  });
  const result = await spotify.searchSpotifyCatalog(8, "  Artist  ", 50);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("type"), "track,artist");
  assert.equal(requests[0].searchParams.get("limit"), "10");
  assert.equal(requests[0].searchParams.get("q"), "Artist");
  assert.equal(result.tracks[0].name, "Song");
  assert.deepEqual(result.artists, [
    {id:ownedId,uri:artist.uri,name:"Artist",imageUrl:"https://i.scdn.co/image/portrait"},
    {id:followedId,uri:`spotify:artist:${followedId}`,name:"Artist",imageUrl:null},
  ]);
  assert.equal((await spotify.searchSpotifyTracks(8, "Artist")).length, 1);
  assert.equal(requests[1].searchParams.get("type"), "track");
  await assert.rejects(spotify.searchSpotifyCatalog(8, "  "), {status:400,code:"spotify_query_required"});
  assert.equal(requests.length, 2);
});

function artistProvider(t, {topStatus=200,albumsStatus=200,albums,failedAlbumOffset=0} = {}) {
  const requests=[];
  const artist={id:ownedId,uri:`spotify:artist:${ownedId}`,name:"Artist",images:[{url:"https://i.scdn.co/image/portrait"}]};
  const artistTrack={...track,artists:[{id:ownedId,name:"Artist"}]};
  const release={id:followedId,uri:`spotify:album:${followedId}`,name:"Album",album_type:"album",release_date:"2026-08-01",images:[{url:"https://i.scdn.co/image/cover"}]};
  t.mock.method(globalThis,"fetch",async input=>{
    const url=new URL(input);requests.push(url);
    if(url.pathname===`/v1/artists/${ownedId}`)return Response.json(artist);
    if(url.pathname===`/v1/artists/${ownedId}/top-tracks`)return Response.json(topStatus===200?{tracks:[artistTrack]}:{error:{message:"Unavailable"}},{status:topStatus});
    if(url.pathname===`/v1/artists/${ownedId}/albums`){
      const limit=Number(url.searchParams.get("limit"));
      const offset=Number(url.searchParams.get("offset")??0);
      if(!Number.isInteger(limit)||limit<1||limit>10)return Response.json({error:{message:"Invalid limit"}},{status:400});
      if(albumsStatus!==200&&offset===failedAlbumOffset)return Response.json({error:{}},{status:albumsStatus});
      const items=albums??[release,release,{...release,uri:track.uri},null];
      return Response.json({items:items.slice(offset,offset+limit),offset,limit,total:items.length,
        next:offset+limit<items.length?`https://api.spotify.test${url.pathname}?offset=${offset+limit}&limit=${limit}`:null});
    }
    if(url.pathname==="/v1/search"&&url.searchParams.get("type")==="playlist")return Response.json({playlists:{items:[playlist(collaborativeId,"Spotify"),null,{...playlist(ownedId,"other"),uri:track.uri}]}});
    if(url.pathname==="/v1/search"&&url.searchParams.get("type")==="track")return Response.json({tracks:{items:[artistTrack,{...track,artists:[{id:followedId,name:"Artist"}]}]}});
    throw Error(`Unexpected request: ${url}`);
  });
  return requests;
}

test("artist profiles include ranked songs, distinct releases, and real playlist results", async t=>{
  const requests=artistProvider(t);
  const profile=await spotify.spotifyArtistProfile(21,ownedId);
  assert.equal(requests.length,4);
  assert.equal(profile.artist.name,"Artist");
  assert.equal(profile.artist.imageUrl,"https://i.scdn.co/image/portrait");
  assert.equal(profile.tracksSource,"top");
  assert.equal(profile.tracks[0].name,"Song");
  assert.deepEqual(profile.releases,[{id:followedId,uri:`spotify:album:${followedId}`,name:"Album",imageUrl:"https://i.scdn.co/image/cover",type:"album",releaseDate:"2026-08-01"}]);
  assert.equal(profile.playlists.length,1);
  assert.equal(profile.playlists[0].owner,"Spotify");
  assert.deepEqual(profile.errors,{});
});

function artistReleases(count) {
  return Array.from({length:count},(_,index)=>{
    const id=`release${String(index).padStart(15,"0")}`;
    return {id,uri:`spotify:album:${id}`,name:`Release ${index}`,album_type:["album","single","compilation"][index%3],release_date:"2026-08-01",images:[]};
  });
}

for(const count of [0,10,13,40]) {
  test(`discography loads ${count} available releases in supported pages up to the shelf limit`,async t=>{
    const albums=artistReleases(count);
    const requests=artistProvider(t,{albums});
    const profile=await spotify.spotifyArtistProfile(25,ownedId);
    assert.deepEqual(profile.errors,{});
    assert.deepEqual(profile.releases.map(release=>release.id),albums.slice(0,30).map(release=>release.id));
    assert.deepEqual(profile.releases.map(release=>release.type),albums.slice(0,30).map(release=>release.album_type));
    const pages=requests.filter(url=>url.pathname.endsWith("/albums"));
    const pageCount=Math.max(1,Math.ceil(Math.min(count,30)/10));
    assert.deepEqual(pages.map(url=>Number(url.searchParams.get("offset")??0)),Array.from({length:pageCount},(_,index)=>index*10));
    for(const url of pages){
      assert.equal(url.searchParams.get("limit"),"10");
      assert.equal(url.searchParams.get("include_groups"),"album,single,compilation");
    }
  });
}

test("discography stops paging after a provider error and keeps songs and playlists available",async t=>{
  const requests=artistProvider(t,{albums:artistReleases(40),albumsStatus:429,failedAlbumOffset:10});
  const profile=await spotify.spotifyArtistProfile(26,ownedId);
  assert.match(profile.errors.releases,/too many requests/i);
  assert.equal(profile.tracks.length,1);
  assert.equal(profile.playlists.length,1);
  assert.equal(requests.filter(url=>url.pathname.endsWith("/albums")).length,2);
});

for (const topStatus of [403,404,410]) {
  test(`artist profiles fall back from unavailable top tracks (${topStatus}) without claiming a ranking`,async t=>{
    const requests=artistProvider(t,{topStatus});
    const profile=await spotify.spotifyArtistProfile(22,ownedId);
    assert.equal(profile.tracksSource,"search");
    assert.equal(profile.tracks.length,1,"only songs with the selected artist ID are included");
    assert.equal(requests.find(url=>url.searchParams.get("type")==="track").searchParams.get("q"),'artist:"Artist"');
    assert.equal(profile.releases.length,1);
    assert.deepEqual(profile.errors,{});
  });
}

test("unavailable profile sections report errors while the remaining content stays browsable",async t=>{
  const requests=artistProvider(t,{topStatus:429,albumsStatus:503});
  const profile=await spotify.spotifyArtistProfile(23,ownedId);
  assert.equal(profile.tracks.length,0);
  assert.match(profile.errors.tracks,/too many requests/i);
  assert.match(profile.errors.releases,/HTTP 503/);
  assert.equal(profile.playlists.length,1);
  assert.equal(requests.some(url=>url.searchParams.get("type")==="track"),false,"rate limiting must not trigger more song requests");
});

test("artist profile IDs are validated before any provider request",async t=>{
  const requests=artistProvider(t);
  for(const id of ["","bad","../me","spotify:artist:"+ownedId])await assert.rejects(spotify.spotifyArtistProfile(24,id),{status:400,code:"invalid_spotify_artist"});
  assert.equal(requests.length,0);
});

function provider(t, failures = new Map()) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    calls.push(url.pathname);
    const failure = failures.get(url.pathname);
    if (failure) return Response.json({ error: { message: "Provider error" } }, failure);
    const owner = options.headers.Authorization.endsWith("second-account") ? "second" : "me";
    const entries = [playlist(ownedId, owner), playlist(followedId, "other"), playlist(collaborativeId, "other", true)];
    if (url.pathname === "/v1/me") return Response.json({ id: owner });
    if (url.pathname === "/v1/me/tracks") return Response.json({ total: 17, items: [{ track }] });
    if (url.pathname === "/v1/me/playlists") return Response.json({ items: entries });
    if (url.pathname === `/v1/playlists/${ownedId}`) return Response.json(entries[0]);
    if (url.pathname === `/v1/playlists/${ownedId}/items`) return Response.json({ items: [{ item: track }] });
    throw Error(`Unexpected request: ${url.pathname}`);
  });
  return calls;
}

test("healthy libraries retain Liked Songs, ownership and collaborative permissions; metadata calls are shared", async t => {
  const calls = provider(t);
  const [first, second] = await Promise.all([spotify.spotifyUserPlaylists(1), spotify.spotifyUserPlaylists(1)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(p => p.id), ["liked-songs", ownedId, collaborativeId]);
  assert.equal(first[0].trackCount, 17);
  assert.equal(first[1].canEditDetails, true);
  assert.equal(first[2].canAddTracks, true);
  assert.equal(first[2].canDelete, false);
  assert.equal(calls.filter(p => p === "/v1/me").length, 1);
  assert.equal(calls.filter(p => p === "/v1/me/tracks").length, 1);
});

test("throttled auxiliary requests cannot hide playlists or their songs, and respect the cooldown", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const failures = new Map([
    ["/v1/me", { status: 429, headers: { "Retry-After": "120" } }],
    ["/v1/me/tracks", { status: 429, headers: { "Retry-After": "120" } }],
  ]);
  const calls = provider(t, failures);
  const first = await spotify.spotifyUserPlaylists(2);
  assert.deepEqual(first.map(p => p.id), [ownedId, followedId, collaborativeId]);
  assert.equal(first[0].canEditDetails, false, "unknown identity must not grant ownership");
  const detail = await spotify.spotifyPlaylistTracks(2, ownedId);
  assert.equal(detail.tracks[0].name, "Song");
  assert.equal(detail.playlist.canDelete, false);
  await assert.rejects(spotify.spotifyRenamePlaylist({ userId: 2, playlistId: ownedId, name: "Rename" }), { code: "spotify_rate_limited" });
  now += 61_000;
  await spotify.spotifyUserPlaylists(2);
  assert.equal(calls.filter(p => p === "/v1/me").length, 1);
  assert.equal(calls.filter(p => p === "/v1/me/tracks").length, 1);
  failures.clear();
  now += 60_000;
  const recovered = await spotify.spotifyUserPlaylists(2);
  assert.deepEqual(recovered.map(p => p.id), ["liked-songs", ownedId, collaborativeId]);
  assert.equal(recovered[1].canEditDetails, true);
  assert.equal(calls.filter(p => p === "/v1/me").length, 2);
});

test("a new Spotify connection cannot reuse the previous account's metadata", async t => {
  const calls = provider(t);
  await spotify.spotifyUserPlaylists(3);
  spotify.credentials.set(3, "second-account");
  const result = await spotify.spotifyUserPlaylists(3);
  assert.equal(result.find(p => p.id === ownedId).ownerId, "second");
  assert.equal(result.find(p => p.id === ownedId).canDelete, true);
  assert.equal(calls.filter(p => p === "/v1/me").length, 2);
});

test("authentication failures remain visible and failed metadata can recover", async t => {
  const failures = new Map([["/v1/me", { status: 401 }]]);
  provider(t, failures);
  await assert.rejects(spotify.spotifyUserPlaylists(4), { status: 409, code: "provider_authentication_failed" });
  failures.clear();
  assert.equal((await spotify.spotifyUserPlaylists(4))[0].id, "liked-songs");
});

test("playlist throttling is reported accurately instead of returning an empty library", async t => {
  provider(t, new Map([["/v1/me/playlists", { status: 429, headers: { "Retry-After": "90" } }]]));
  await assert.rejects(spotify.spotifyUserPlaylists(5), { status: 429, code: "spotify_rate_limited", retryAfterMs: 90_000 });
});

test("missing Retry-After uses a cooldown and other connected apps keep their existing error behavior", async t => {
  provider(t, new Map([["/v1/me", { status: 429 }]]));
  await assert.rejects(spotify.spotifyApiRequest({ userId: 6, method: "GET", endpoint: "/v1/me" }),
    { status: 429, code: "spotify_rate_limited", retryAfterMs: 60_000 });
  await assert.rejects(spotify.embeddedProviderRequest({ userId: 6, integration: { slug: "other", name: "Other" }, request: { method: "GET", endpoint: "/v1/me" } }),
    { status: 502, code: "provider_request_failed" });
});

test("Spotify distinguishes a missing playback device from failed song lookup without exposing provider payloads", async t => {
  let status = 404;
  let payload = { error: { status, reason: "NO_ACTIVE_DEVICE", message: "Player command failed: No active device found" } };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
  const play = () => spotify.spotifyApiRequest({ userId: 7, method: "PUT", endpoint: "/v1/me/player/play" });
  await assert.rejects(play(), { status: 409, code: "spotify_device_unavailable" });
  payload = { error: { message: "Player command failed: No active device found" } };
  await assert.rejects(play(), { status: 409, code: "spotify_device_unavailable" });

  payload = { error: { message: "private provider details" } };
  await assert.rejects(play(), { status: 502, code: "provider_request_failed", message: "Spotify rejected the playback request (HTTP 404). Try again shortly." });
  status = 400;
  await assert.rejects(spotify.searchSpotifyTracks(7, "shoot the thrill by ac/dc"),
    { status: 502, code: "provider_request_failed", message: "Spotify rejected the song search (HTTP 400). Try again shortly." });
  status = 401;
  await assert.rejects(play(), { status: 409, code: "provider_authentication_failed" });
  status = 403;
  await assert.rejects(play(), { status: 403, code: "provider_request_forbidden" });
});

test("playback throttling pauses reads and writes until Retry-After expires without blocking artist browsing", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const requests = [];
  t.mock.method(globalThis, "fetch", async input => {
    requests.push(new URL(input));
    return requests.length === 1
      ? Response.json({error:{}}, {status:429, headers:{"Retry-After":"90"}})
      : Response.json({tracks:{items:[]},artists:{items:[]}});
  });
  const status = () => spotify.spotifyApiRequest({userId:801,method:"GET",endpoint:"/v1/me/player"});
  const play = () => spotify.spotifyApiRequest({userId:801,method:"PUT",endpoint:"/v1/me/player/play"});
  await assert.rejects(status(), {code:"spotify_rate_limited",retryAfterMs:90_000});
  now += 10_000;
  await assert.rejects(play(), {code:"spotify_rate_limited",retryAfterMs:80_000});
  await assert.rejects(status(), {code:"spotify_rate_limited",retryAfterMs:80_000});
  assert.equal(requests.length,1,"cooldown retries never reach Spotify or extend the deadline");
  await spotify.searchSpotifyCatalog(801,"Post Malone");
  await spotify.spotifyApiRequest({userId:802,method:"GET",endpoint:"/v1/me/player"});
  assert.equal(requests.length,3,"catalog requests and other users remain available");
  now += 80_000;
  await play();
  assert.equal(requests.length,4,"playback recovers at the provider's deadline");
});

test("concurrent player status reads share one provider request but playback commands remain distinct", async t => {
  let calls = 0;
  let release;
  t.mock.method(globalThis,"fetch",async()=>{
    calls++;
    await new Promise(resolve=>{release=resolve;});
    return Response.json({});
  });
  const input={userId:803,method:"GET",endpoint:"/v1/me/player"};
  const reads=[spotify.spotifyApiRequest(input),spotify.spotifyApiRequest(input)];
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  release();
  await Promise.all(reads);
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({});});
  await spotify.spotifyApiRequest(input);
  assert.equal(calls,2,"completed reads do not hide fresh playback state");
  await Promise.all([1,2].map(()=>spotify.spotifyApiRequest({...input,method:"POST",endpoint:"/v1/me/player/next"})));
  assert.equal(calls,4,"commands must never be coalesced");
});
