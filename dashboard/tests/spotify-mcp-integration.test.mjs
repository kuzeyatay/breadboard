import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { findNangoIntegration } = await import("../src/lib/nango/catalog.ts");
const {
  SPOTIFY_OAUTH_CALLBACK_PATH,
  spotifyClientId,
  spotifyOAuthCallbackOrigin,
} = await import("../src/lib/spotify/config.ts");
const {
  isSpotifyCatalogRequest,
  isSpotifyPlaybackRequest,
  isSpotifyRequest,
  spotifyCommandText,
  spotifyPlayerAssistantIndex,
} = await import(
  "../src/lib/hermes/spotify-intent.ts"
);
const { loadSpotifyAgentDefinition } = await import(
  "../src/lib/spotify-agent/agent.ts"
);
const { spotifyQueueStep } = await import("../src/lib/spotify/queue.ts");
const { selectSpotifyPhoneDevice } = await import(
  "../src/lib/spotify/devices.ts"
);

test("Explicit phone selection prefers an unrestricted phone over another active device", () => {
  const phone = selectSpotifyPhoneDevice({
    devices: [
      {
        id: "computer-device-001",
        name: "Desk",
        type: "Computer",
        is_active: true,
        is_restricted: false,
      },
      {
        id: "old-phone-device-001",
        name: "Old phone",
        type: "Smartphone",
        is_active: true,
        is_restricted: true,
      },
      {
        id: "phone-device-001",
        name: "My phone",
        type: "Smartphone",
        is_active: false,
        is_restricted: false,
      },
    ],
  });
  assert.deepEqual(phone, {
    id: "phone-device-001",
    name: "My phone",
    type: "smartphone",
    isActive: false,
    isRestricted: false,
  });
  assert.equal(
    selectSpotifyPhoneDevice({
      devices: [
        {
          id: "speaker-device-001",
          name: "Kitchen",
          type: "Speaker",
          is_active: true,
          is_restricted: false,
        },
      ],
    }),
    null,
  );
});

test("Spotify uses public-client PKCE with the live loopback callback", () => {
  const spotify = findNangoIntegration("spotify");
  assert.ok(spotify);
  for (const scope of [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-modify-private",
    "playlist-modify-public",
  ]) {
    assert.ok(spotify.scopes.includes(scope));
  }
  assert.equal(spotifyClientId(), "cb7cb4f043ed42759672098759409ba8");
  assert.equal(
    SPOTIFY_OAUTH_CALLBACK_PATH,
    "/api/hermes/mcp/oauth/callback",
  );
  assert.equal(
    spotifyOAuthCallbackOrigin("http://127.0.0.1:43123"),
    "http://127.0.0.1:43123",
  );
  assert.equal(
    spotifyOAuthCallbackOrigin("http://localhost:43123"),
    "http://127.0.0.1:43123",
  );
  assert.throws(() => spotifyOAuthCallbackOrigin("http://example.com"));
  const spotifyRoute = fs.readFileSync(
    new URL(
      "../src/app/api/hermes/connections/spotify/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(spotifyRoute, /callbackOrigin,/);
  assert.doesNotMatch(spotifyRoute, /127\.0\.0\.1:3000/);
  const broker = fs.readFileSync(
    new URL("../src/lib/connected-apps/broker.ts", import.meta.url),
    "utf8",
  );
  assert.match(broker, /clientSecret: null/);
  assert.match(broker, /code_challenge_method: "S256"/);
  assert.match(broker, /\/api\/hermes\/mcp\/oauth\/callback/);
  assert.match(broker, /refreshed\.scope = stored\.scope/);
});

test("Spotify intent reaches the live catalog without confusing search with playback", () => {
  const originalRequest = "Can you play the song 'Shoot the Thrill' by AC/DC?";
  assert.equal(isSpotifyPlaybackRequest(originalRequest), true);
  assert.deepEqual(spotifyCommandText({ text: originalRequest, surface: "dashboard_terminal", authenticated: true }),
    { text: `/spotify ${originalRequest}`, automatic: true });
  assert.equal(isSpotifyRequest("play Radiohead"), true);
  assert.equal(
    isSpotifyRequest(
      "can you now play a song that walter bishop would liston to when hes high on lsd",
    ),
    true,
  );
  assert.equal(isSpotifyRequest("pause the music"), true);
  assert.equal(
    isSpotifyRequest("create me a playlist that sounds from the 90s and play it"),
    true,
  );
  for (const request of [
    "recommend songs like Epitaph",
    "find some Radiohead tracks",
    "what album is Epitaph on?",
    "who sings Paranoid Android?",
    "show me the best shoegaze albums",
  ]) {
    assert.equal(isSpotifyCatalogRequest(request), true, request);
    assert.equal(isSpotifyRequest(request), true, request);
  }
  assert.equal(isSpotifyPlaybackRequest("recommend songs like Epitaph"), false);
  assert.equal(isSpotifyRequest("explain music theory"), false);
  assert.equal(isSpotifyRequest("write me a song"), false);
  assert.equal(isSpotifyRequest("play a video"), false);
  assert.deepEqual(
    spotifyCommandText({
      text: "play Radiohead",
      surface: "dashboard_terminal",
      authenticated: true,
    }),
    { text: "/spotify play Radiohead", automatic: true },
  );
  assert.deepEqual(
    spotifyCommandText({
      text: "can you now play a song that walter bishop would liston to when hes high on lsd",
      surface: "dashboard_terminal",
      authenticated: true,
    }),
    {
      text: "/spotify can you now play a song that walter bishop would liston to when hes high on lsd",
      automatic: true,
    },
  );
  assert.deepEqual(
    spotifyCommandText({
      text: "recommend songs like Epitaph",
      surface: "dashboard_terminal",
      authenticated: true,
    }),
    { text: "/spotify recommend songs like Epitaph", automatic: true },
  );
  const agent = loadSpotifyAgentDefinition();
  assert.equal(agent.slug, "agent-spotify");
  assert.match(agent.instructions, /inline player is the default playback target/i);
  assert.match(agent.instructions, /returns status=playing only after Spotify confirms/i);
  assert.match(agent.instructions, /Never tell the user to press Play/i);
  assert.match(agent.instructions, /Never infer a phone target from available devices/i);
  assert.doesNotMatch(agent.instructions, /status=ready|falls back to Breadboard/i);
  assert.match(agent.instructions, /Respond naturally/);
  assert.match(agent.instructions, /phrase the response freely/);
  assert.doesNotMatch(agent.instructions, /say the track is ready|Keep responses short/);
  assert.match(agent.instructions, /spotify_create_playlist/);
  assert.match(agent.instructions, /Spotify's live catalog/);
  assert.match(agent.instructions, /call spotify_search before answering/);
  assert.match(agent.instructions, /Always choose and send target/);
  assert.match(agent.instructions, /For playback controls/);
  assert.doesNotMatch(agent.instructions, /open Spotify|remote MCP|Music Assistant|Sendspin/);
});

test("the inline player survives later messages and follows contextual Spotify turns", () => {
  const messages = [
    { role: "user", content: "play Radiohead" },
    {
      role: "assistant",
      content: "I went with Let Down — that opening feels weightless.",
      tools: [{ toolName: "spotify_prepare_playback" }],
    },
  ];
  assert.equal(spotifyPlayerAssistantIndex(messages), 1);

  messages.push(
    { role: "user", content: "thanks" },
    { role: "assistant", content: "You're welcome." },
  );
  assert.equal(
    spotifyPlayerAssistantIndex(messages),
    1,
    "a later non-music turn must not unmount the current player",
  );

  messages.push(
    { role: "user", content: "another one please, more melancholic" },
    {
      role: "assistant",
      content: "Try Epitaph next. It is darker, slower, and properly devastating.",
      tools: [{ toolName: "spotify_prepare_playback" }],
    },
  );
  assert.equal(
    spotifyPlayerAssistantIndex(messages),
    5,
    "the tool call identifies a contextual follow-up as a music turn",
  );

  messages.push(
    { role: "user", content: "create a playlist for a late-night drive" },
    { role: "assistant", content: "" },
  );
  assert.equal(
    spotifyPlayerAssistantIndex(messages),
    5,
    "a new request keeps the confirmed player until its Spotify tool starts",
  );

  messages[7].tools = [
    { toolName: "spotify_create_playlist", status: "running" },
  ];
  assert.equal(
    spotifyPlayerAssistantIndex(messages, 7),
    5,
    "the active assistant row cannot move the player while it is thinking",
  );

  messages[7].tools[0].status = "failed";
  assert.equal(
    spotifyPlayerAssistantIndex(messages),
    5,
    "a failed Spotify tool restores the previous confirmed player",
  );

  messages[7].tools[0].status = "completed";
  assert.equal(
    spotifyPlayerAssistantIndex(messages, 7),
    5,
    "even a completed tool waits for the assistant turn to settle",
  );
  assert.equal(
    spotifyPlayerAssistantIndex(messages),
    7,
    "a completed Spotify tool keeps the player on the new turn",
  );
});

test("a first Spotify player waits for a completed assistant turn", () => {
  const messages = [
    { role: "user", content: "play Radiohead" },
    { role: "assistant", content: "" },
  ];

  assert.equal(spotifyPlayerAssistantIndex(messages, 1), -1);
  messages[1].tools = [
    { toolName: "spotify_prepare_playback", status: "running" },
  ];
  assert.equal(spotifyPlayerAssistantIndex(messages, 1), -1);
  messages[1].tools[0].status = "completed";
  assert.equal(spotifyPlayerAssistantIndex(messages, 1), -1);
  assert.equal(spotifyPlayerAssistantIndex(messages), 1);
});

test("catalog-only Spotify searches do not mount a playback widget", () => {
  const messages = [
    { role: "user", content: "recommend songs like Epitaph" },
    {
      role: "assistant",
      content: "Try Starless, The Court of the Crimson King, and Fallen Angel.",
      tools: [{ toolName: "spotify_search" }],
    },
  ];
  assert.equal(spotifyPlayerAssistantIndex(messages), -1);

  messages.push(
    { role: "user", content: "play the first one" },
    {
      role: "assistant",
      content: "Starless it is.",
      tools: [{ toolName: "spotify_play" }],
    },
  );
  assert.equal(spotifyPlayerAssistantIndex(messages), 3);
});

test("playlist skips are calculated from Breadboard's recorded queue", () => {
  const queue = [
    "spotify:track:0000000000000000000001",
    "spotify:track:0000000000000000000002",
    "spotify:track:0000000000000000000003",
  ];
  assert.deepEqual(
    spotifyQueueStep(queue, "0000000000000000000001", "next"),
    {
      targetId: "0000000000000000000002",
      targetUri: queue[1],
      targetIndex: 1,
      playbackUris: [queue[1], queue[2], queue[0]],
    },
  );
  assert.deepEqual(
    spotifyQueueStep(queue, "0000000000000000000001", "previous"),
    {
      targetId: "0000000000000000000003",
      targetUri: queue[2],
      targetIndex: 2,
      playbackUris: [queue[2], queue[0], queue[1]],
    },
  );
  assert.equal(
    spotifyQueueStep(queue, "9999999999999999999999", "next")?.targetIndex,
    0,
    "an unrelated ambient Spotify track must enter at the first playlist item",
  );
  assert.equal(
    spotifyQueueStep(queue, "9999999999999999999999", "previous")?.targetIndex,
    2,
    "previous from an unrelated ambient track must enter at the last playlist item",
  );
});

test("Spotify skill selects native tools and has no MCP dependency", () => {
  const skill = fs.readFileSync(
    path.join(process.cwd(), "..", "hermes-config", "skill", "spotify", "SKILL.md"),
    "utf8",
  );
  assert.match(
    skill,
    /requiredTools:\s*\[spotify_search, spotify_play, spotify_create_playlist\]/,
  );
  assert.match(skill, /requiredMcpServers:\s*\[\]/);
  assert.match(skill, /Settings → Connections → Spotify → Connect/);
  assert.match(skill, /no required sentence or response template/i);
  assert.match(skill, /phrase the response freely/i);
  assert.match(skill, /Spotify's live catalog/);
  assert.match(skill, /call `spotify_search` before answering/);
  assert.match(skill, /Always choose and send `target`/);
  assert.match(skill, /inline player is the default playback target/i);
  assert.match(skill, /Never tell the user to press Play/i);
  assert.match(skill, /Never infer a phone target from available devices/i);
  assert.doesNotMatch(skill, /status: ready|falls back to Breadboard/i);
  assert.doesNotMatch(skill, /say the track is ready/i);
  assert.doesNotMatch(skill, /required `spotify` MCP/);
});

test("Spotify login lives in Connections and inline playback uses the managed engine", () => {
  const connections = fs.readFileSync(
    new URL("../src/app/components/settings-connections.tsx", import.meta.url),
    "utf8",
  );
  const mcp = fs.readFileSync(
    new URL("../src/app/components/settings-mcp.tsx", import.meta.url),
    "utf8",
  );
  const spotifyRoute = fs.readFileSync(
    new URL("../src/app/api/hermes/connections/spotify/route.ts", import.meta.url),
    "utf8",
  );
  const nativeToolRoute = fs.readFileSync(
    new URL("../src/app/api/hermes/tools/spotify/route.ts", import.meta.url),
    "utf8",
  );
  const spotifyService = fs.readFileSync(
    new URL("../src/lib/spotify/service.ts", import.meta.url),
    "utf8",
  );
  const player = fs.readFileSync(
    new URL("../src/app/components/hermes/inline-spotify-player.tsx", import.meta.url),
    "utf8",
  );
  const playerPalette = fs.readFileSync(
    new URL("../src/lib/spotify/player-palette.ts", import.meta.url),
    "utf8",
  );
  const runtimePanel = fs.readFileSync(
    new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
    "utf8",
  );
  const engine = fs.readFileSync(
    new URL("../src/lib/spotify/playback-engine.ts", import.meta.url),
    "utf8",
  );
  const engineRoute = fs.readFileSync(
    new URL(
      "../src/app/api/hermes/connections/spotify/engine/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const runtimeEngine = fs.readFileSync(
    new URL(
      "../scripts/runtime-v2-spotify-playback-service.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const runtimeClient = fs.readFileSync(
    new URL("../src/lib/spotify/runtime-service.ts", import.meta.url),
    "utf8",
  );
  const viewLease = fs.readFileSync(
    new URL("../src/lib/spotify/view-lease.ts", import.meta.url),
    "utf8",
  );
  const playbackRoute = fs.readFileSync(
    new URL(
      "../src/app/api/hermes/connections/spotify/playback/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const broker = fs.readFileSync(
    new URL("../src/lib/connected-apps/broker.ts", import.meta.url),
    "utf8",
  );
  assert.match(connections, /\/api\/hermes\/connections\/spotify/);
  assert.match(connections, />\s*Spotify\s*</);
  assert.match(mcp, /connection\.slug !== "spotify"/);
  assert.match(spotifyRoute, /beginEmbeddedOAuth/);
  assert.doesNotMatch(spotifyRoute, /startMcpAuthentication|spotifyMcpPresetBody/);
  assert.match(nativeToolRoute, /spotify_play/);
  assert.match(nativeToolRoute, /spotify_create_playlist/);
  assert.match(nativeToolRoute, /createSpotifyPlaylist/);
  assert.doesNotMatch(nativeToolRoute, /startInlinePlaylistPlayback/);
  assert.doesNotMatch(nativeToolRoute, /player: "inline"|status: "ready"/);
  assert.match(nativeToolRoute, /startPlayback/);
  assert.match(nativeToolRoute, /player: target/);
  assert.match(nativeToolRoute, /status: "playing"/);
  assert.match(nativeToolRoute, /playbackStarted: true/);
  assert.match(nativeToolRoute, /spotify_playback_failed/);
  assert.match(nativeToolRoute, /current\.deviceId === device\.id/);
  assert.match(nativeToolRoute, /current\?\.isPlaying === true/);
  assert.match(nativeToolRoute, /current\.track\.uri === input\.uris\[0\]/);
  assert.match(nativeToolRoute, /controlSpotifyPlayback/);
  assert.doesNotMatch(nativeToolRoute, /instruction:/);
  assert.match(nativeToolRoute, /recordSpotifyPlaybackIntent/);
  assert.match(nativeToolRoute, /toolName === "spotify_search" \? 5 : 10/);
  assert.match(spotifyService, /SPOTIFY_SEARCH_RESULT_LIMIT = 10/);
  assert.match(spotifyService, /SPOTIFY_OPTIONAL_CONNECTION_SCOPES/);
  assert.match(spotifyService, /playlist-read-private/);
  assert.match(spotifyService, /endpoint: "\/v1\/me\/player\/devices"/);
  assert.match(spotifyService, /endpoint: "\/v1\/me\/playlists"/);
  assert.match(spotifyService, /endpoint: `\/v1\/playlists\/\$\{id\}\/items`/);
  assert.match(
    spotifyService,
    /Math\.min\(SPOTIFY_SEARCH_RESULT_LIMIT, Math\.max\(1, limit\)\)/,
  );
  assert.doesNotMatch(player, /sdk\.scdn\.co\/spotify-player\.js/);
  assert.match(player, /aria-label="Spotify player"/);
  assert.match(player, /MAX_INTENT_POLLS/);
  assert.doesNotMatch(player, /\bElectron\//);
  assert.doesNotMatch(engine, /node:child_process|\bspawn\(|detached:|\.unref\(\)/);
  assert.match(engine, /readSpotifyPlaybackRuntimeStatus/);
  assert.match(runtimeEngine, /import \{ spawn \} from "node:child_process"/);
  assert.match(runtimeEngine, /--headless=new/);
  assert.match(runtimeEngine, /--autoplay-policy=no-user-gesture-required/);
  assert.match(runtimeEngine, /detached: false/);
  assert.match(runtimeEngine, /shell: false/);
  assert.match(runtimeEngine, /stdio: "ignore"/);
  assert.match(runtimeEngine, /childEnvironment\(\)/);
  assert.doesNotMatch(runtimeEngine, /child\.unref\(\)|taskkill|detached: true/);
  assert.match(runtimeClient, /readSupervisedServiceSnapshot\("spotify-playback"/);
  assert.match(viewLease, /acquireServiceLease\(\s*"spotify-playback"/);
  assert.match(viewLease, /SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS/);
  assert.match(viewLease, /releaseSpotifyPlaybackRuntimeSession/);
  assert.match(engineRoute, /spotifyBrowserAccessToken/);
  assert.match(engineRoute, /registerSpotifyPlaybackEngine/);
  assert.match(engineRoute, /renewSpotifyPlaybackViewLease/);
  assert.match(engineRoute, /releaseSpotifyPlaybackViewLease/);
  assert.match(engineRoute, /await spotifyPlaybackEngineStatus\(userId\)/);
  assert.doesNotMatch(engineRoute, /ensureSpotifyPlaybackEngine|mode === "page"/);
  for (const action of ["pause", "resume", "previous", "next", "seek"]) {
    assert.match(playbackRoute, new RegExp(`action === "${action}"`));
  }
  assert.match(player, /postAction\("resume"\)/);
  assert.match(player, /managedQueueLoaded/);
  assert.match(player, /applyManagedPlayback/);
  assert.match(player, /paletteFromCover/);
  assert.match(playerPalette, /relativeLuminance/);
  assert.match(player, /--spotify-control-fg/);
  assert.match(playbackRoute, /spotifyCurrentPlaybackState/);
  assert.match(playbackRoute, /spotifyTargetDevice/);
  assert.match(playbackRoute, /activateSpotifyPhonePlayback/);
  assert.match(playbackRoute, /playbackAfterChange/);
  assert.match(playbackRoute, /spotifyQueueStep/);
  assert.match(playbackRoute, /body: \{ uris: step\.playbackUris \}/);
  assert.doesNotMatch(playbackRoute, /endpoint: `\/v1\/me\/player\/\$\{action\}`/);
  assert.match(player, /currentTrackId: visibleTrack\.id/);
  assert.match(player, /aria-label="Loading Spotify player"/);
  assert.match(player, /size-10 animate-pulse/);
  assert.match(player, /intentLoading \? <SpotifyPlayerLoading \/> : null/);
  assert.match(player, /turnPending \|\| attempts < MAX_INTENT_POLLS/);
  assert.match(player, /paletteSource === \(visibleTrack\.imageUrl \?\? null\)/);
  assert.match(runtimePanel, /key=\{`\$\{sessionId\}:\$\{inlineSpotify\.requestedAt \?\? ""\}`\}/);
  assert.match(runtimePanel, /turnPending=\{/);
  assert.match(
    runtimePanel,
    /spotifyPlayerAssistantIndex\(\s*messages,\s*runInFlight \? lastAssistantIndex : -1,\s*\)/,
  );
  assert.match(playbackRoute, /endpoint: "\/v1\/me\/library"/);
  assert.match(playbackRoute, /query: \{ uris: `spotify:track:\$\{id\}` \}/);
  assert.doesNotMatch(playbackRoute, /endpoint: "\/v1\/me\/tracks"/);
  assert.match(spotifyService, /endpoint: "\/v1\/me\/library\/contains"/);
  assert.match(player, /library\.trackId !== visibleTrack\.id/);
  assert.match(player, /disabled=\{busy \|\| !visibleTrack\}/);
  assert.doesNotMatch(player, /requiresDevice|deviceIdRef/);
  assert.match(player, /setSaved\(result\.library\?\.saved \?\? !saved\)/);
  assert.match(broker, /provider_request_forbidden/);
  assert.match(broker, /authenticationFailed \? 409 : forbidden \? 403 : 502/);
  assert.match(playbackRoute, /intent\?\.queueUris\.includes\(current\.track\.uri\)/);
  assert.match(player, /connection\?\.playback/);
  assert.match(
    player,
    /Spotify is not currently available on your phone\. Open Spotify on the phone and try again\./,
  );
  assert.match(player, /setManagedQueueLoaded\(true\)/);
  assert.match(player, /window\.setTimeout\(\(\) => void load\(\), POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(player, /setInterval\(\(\) => void load\(\), POLL_INTERVAL_MS\)/);
  assert.match(player, /method: "POST"/);
  assert.match(player, /method: "DELETE"/);
  assert.match(player, /ENGINE_VIEW_HEARTBEAT_MS/);
  assert.doesNotMatch(player, /spotify:\/\/|open\.spotify\.com|window\.open/);
});
