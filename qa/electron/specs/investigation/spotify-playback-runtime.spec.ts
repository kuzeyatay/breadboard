import { expect, test } from "../../fixtures";
import {
  ensureAuthenticatedDashboard,
  registerAndSignIn,
} from "../../user-journeys";

type HttpProbe = {
  status: number;
  payload: Record<string, unknown>;
  text: string;
};

type SpotifyProbeResult = {
  mode: "provider-unavailable" | "engine-unavailable" | "ready";
  connection: HttpProbe;
  conversation: HttpProbe;
  control: HttpProbe | null;
  engine: HttpProbe | null;
  pause: HttpProbe | null;
  resume: HttpProbe | null;
  releaseStatus: number | null;
};

test.skip(
  process.env["BREADBOARD_QA_INVESTIGATE"] !== "1",
  "Set BREADBOARD_QA_INVESTIGATE=1 to run the Spotify Runtime probe.",
);

test("Spotify playback proves a ready device and control, or reports the real provider blocker", async ({
  qa,
}) => {
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await ensureAuthenticatedDashboard(page);

  const result = await page.evaluate(async (): Promise<SpotifyProbeResult> => {
    const readPayload = async (response: Response): Promise<HttpProbe> => {
      const text = await response.text();
      try {
        return {
          status: response.status,
          payload: JSON.parse(text) as Record<string, unknown>,
          text,
        };
      } catch {
        return { status: response.status, payload: {}, text };
      }
    };
    const sleep = (milliseconds: number) =>
      new Promise((resolve) => window.setTimeout(resolve, milliseconds));

    const connection = await readPayload(
      await fetch("/api/hermes/connections/spotify", { cache: "no-store" }),
    );
    const conversationResponse = await readPayload(
      await fetch("/api/hermes/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "dashboard_terminal",
          title: "Spotify protected-playback investigation",
        }),
        cache: "no-store",
      }),
    );
    const session = conversationResponse.payload.session as
      | Record<string, unknown>
      | undefined;
    const conversation = typeof session?.id === "string" ? session.id : "";
    const connected = connection.payload.connected === true;

    if (!connected) {
      const control = await readPayload(
        await fetch("/api/hermes/connections/spotify/playback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation,
            action: "pause",
            deviceId: "qa-unavailable-device",
          }),
          cache: "no-store",
        }),
      );
      return {
        mode: "provider-unavailable",
        connection,
        conversation: conversationResponse,
        control,
        engine: null,
        pause: null,
        resume: null,
        releaseStatus: null,
      };
    }

    const viewId = crypto.randomUUID();
    let leaseHeld = false;
    let releaseStatus: number | null = null;
    let mode: SpotifyProbeResult["mode"] = "engine-unavailable";
    let engineResult: HttpProbe | null = null;
    let pause: HttpProbe | null = null;
    let resume: HttpProbe | null = null;
    try {
      let engine = await readPayload(
        await fetch("/api/hermes/connections/spotify/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId }),
          cache: "no-store",
        }),
      );
      leaseHeld = engine.status === 200;

      const deadline = Date.now() + 30_000;
      while (
        engine.status === 200 &&
        engine.payload.ready !== true &&
        engine.payload.status !== "unavailable" &&
        Date.now() < deadline
      ) {
        await sleep(500);
        engine = await readPayload(
          await fetch("/api/hermes/connections/spotify/engine", {
            cache: "no-store",
          }),
        );
      }

      const deviceId =
        engine.payload.ready === true &&
        typeof engine.payload.deviceId === "string"
          ? engine.payload.deviceId
          : null;
      engineResult = engine;
      if (!deviceId) {
        mode = "engine-unavailable";
      } else {
        const control = async (action: "pause" | "resume") =>
          readPayload(
            await fetch("/api/hermes/connections/spotify/playback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversation, action, deviceId }),
              cache: "no-store",
            }),
          );
        pause = await control("pause");
        resume = pause.status === 200 ? await control("resume") : null;
        mode = "ready";
      }
    } finally {
      if (leaseHeld) {
        const release = await fetch(
          "/api/hermes/connections/spotify/engine",
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewId }),
            cache: "no-store",
          },
        ).catch(() => null);
        releaseStatus = release?.status ?? null;
      }
    }
    return {
      mode,
      connection,
      conversation: conversationResponse,
      control: null,
      engine: engineResult,
      pause,
      resume,
      releaseStatus,
    };
  });

  expect(result.connection.status, result.connection.text).toBe(200);
  expect(result.conversation.status, result.conversation.text).toBe(200);

  if (result.mode === "provider-unavailable") {
    test.info().annotations.push({
      type: "spotify-provider",
      description:
        "The isolated QA identity has no Spotify OAuth/Premium session, so real device playback cannot be asserted in this run.",
    });
    expect(result.connection.payload).toMatchObject({ connected: false });
    expect(result.control?.status, result.control?.text).toBe(409);
    expect(result.control?.payload).toMatchObject({
      code: "spotify_connection_required",
    });
    expect(String(result.control?.payload.error)).toContain(
      "Connect Spotify from Settings",
    );
    return;
  }

  expect(result.mode, JSON.stringify(result)).toBe("ready");
  expect(result.engine?.status, result.engine?.text).toBe(200);
  expect(result.engine?.payload).toMatchObject({
    ready: true,
    status: "ready",
  });
  expect(String(result.engine?.payload.deviceId).length).toBeGreaterThanOrEqual(8);
  expect(result.pause?.status, result.pause?.text).toBe(200);
  expect(result.pause?.payload).toMatchObject({ ok: true });
  expect(result.resume?.status, result.resume?.text).toBe(200);
  expect(result.resume?.payload).toMatchObject({ ok: true });
  expect(result.releaseStatus).toBe(200);
});
