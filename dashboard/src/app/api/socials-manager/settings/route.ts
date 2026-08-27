import { NextResponse } from "next/server";

import { requireUserId, RouteError } from "@/lib/server-auth";
import { PostizApiError, type PostizProviderConnection } from "@/lib/socials-manager/api-client.ts";
import { findSocialsManagerProvider, SOCIALS_MANAGER_PROVIDERS } from "@/lib/socials-manager/providers.ts";
import { openPostizSession } from "@/lib/socials-manager/service.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { socialsManagerDefaults } from "@/lib/agent-settings/defaults.ts";
import { readAgentSettings, writeAgentSettings } from "@/lib/agent-settings/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectionField = {
  key: string;
  label: string;
  type: "text" | "password";
  defaultValue?: string;
  hint?: string;
};

function fieldsFor(provider: PostizProviderConnection): ConnectionField[] {
  if (provider.customFields.length) return provider.customFields;
  if (provider.identifier === "telegram") {
    return [{
      key: "channel",
      label: "Channel or group",
      type: "text",
      hint: "Enter its public @username or numeric chat ID after adding the configured Postiz bot.",
    }];
  }
  if (provider.identifier === "moltbook") {
    return [{ key: "apiKey", label: "Moltbook API key", type: "password" }];
  }
  return [];
}

function connectionMode(provider: PostizProviderConnection): string {
  if (provider.customFields.length) return "credentials";
  if (provider.identifier === "telegram" || provider.identifier === "moltbook") {
    return "credentials";
  }
  if (provider.isChromeExtension) return "extension";
  if (provider.isWeb3) return "guided";
  if (provider.isExternal) return "external";
  return "oauth";
}

/**
 * The whole network list, every time.
 *
 * A network that the running Postiz build does not offer for connection is
 * still listed, marked `unavailable`: the checkbox beside it decides what
 * Breadboard *drafts* for, which is a local decision that works with no stack
 * running and no account connected. Dropping those rows would hide half the
 * catalog — Discord, YouTube, Reddit, TikTok, Pinterest among them — behind a
 * connection the user may never want.
 */
async function liveSettings(userId: number) {
  // Opening this dialog *is* the channel-connection flow, which is one of the
  // few things that legitimately needs the real stack. Nothing else on this
  // route activates Postiz: the network checkboxes below are answered from
  // local settings while the containers stay stopped.
  const availability = await openPostizSession({ scope: { userId }, reason: "channels" });
  if (!availability.session) {
    return {
      availability,
      providers: SOCIALS_MANAGER_PROVIDERS.map((provider) => ({
        ...provider,
        connectionMode: "unavailable",
        fields: [] as ConnectionField[],
      })),
      accounts: [],
    };
  }

  const catalog = await availability.session.client.listProviderConnections();
  const byId = new Map(catalog.map((provider) => [provider.identifier, provider]));
  const providers = SOCIALS_MANAGER_PROVIDERS.map((provider) => {
    const connection = byId.get(provider.id);
    if (!connection) {
      return { ...provider, connectionMode: "unavailable", fields: [] as ConnectionField[] };
    }
    return {
      ...provider,
      description: connection.toolTip ?? null,
      connectionMode: connectionMode(connection),
      fields: fieldsFor(connection),
    };
  });

  return {
    availability,
    providers,
    accounts: availability.session.integrations,
  };
}

/**
 * The networks a run drafts for when the message names none. Stored as the
 * Socials Manager's `networks` setting, so this dialog and the agent's own
 * settings page are the same switch rather than two that disagree.
 */
function draftingNetworks(userId: number): string[] {
  const agent = findConfigurableAgent("socials-manager");
  if (!agent) return [];
  return socialsManagerDefaults(readAgentSettings(userId, agent).values).providerIds;
}

function saveDraftingNetworks(userId: number, raw: unknown): string[] {
  const agent = findConfigurableAgent("socials-manager");
  if (!agent) throw new RouteError(500, "socials_manager_settings_unavailable");
  if (!Array.isArray(raw) || raw.length > 128) {
    throw new RouteError(400, "That network selection is not valid.");
  }
  // Read, merge, write: the stored value is the agent's whole settings object,
  // so writing only the networks would reset the artwork preference beside it.
  // Unknown ids are dropped by the catalog's own normalization.
  const current = readAgentSettings(userId, agent).values;
  const saved = writeAgentSettings(userId, agent, { ...current, networks: raw });
  return socialsManagerDefaults(saved.values).providerIds;
}

function present(
  settings: Awaited<ReturnType<typeof liveSettings>>,
  networks: string[],
) {
  return {
    ok: true,
    state: settings.availability.state,
    reason: settings.availability.reason ?? null,
    providers: settings.providers,
    accounts: settings.accounts,
    networks,
  };
}

function responseForError(error: unknown) {
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof PostizApiError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status >= 400 && error.status < 500 ? error.status : 502 },
    );
  }
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "socials_manager_settings_failed" },
    { status: 502 },
  );
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(present(await liveSettings(userId), draftingNetworks(userId)));
  } catch (error) {
    return responseForError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    // Choosing which networks to draft for is a Breadboard-side preference, so
    // it is answered before Postiz is consulted — it has to work while the
    // stack is down, which is exactly when a run drafts locally.
    if (action === "networks") {
      const networks = saveDraftingNetworks(userId, body.networks);
      return NextResponse.json(present(await liveSettings(userId), networks));
    }

    const settings = await liveSettings(userId);
    const session = settings.availability.session;
    if (!session) {
      return NextResponse.json(
        { ok: false, error: settings.availability.reason ?? "Postiz is unavailable." },
        { status: 503 },
      );
    }

    if (action === "disconnect") {
      const integrationId = typeof body.integrationId === "string"
        ? body.integrationId.trim()
        : "";
      if (!integrationId || !session.integrations.some((item) => item.id === integrationId)) {
        return NextResponse.json({ ok: false, error: "Unknown connected account." }, { status: 404 });
      }
      await session.client.deleteIntegration(integrationId);
      return NextResponse.json(present(await liveSettings(userId), draftingNetworks(userId)));
    }

    const providerId = typeof body.providerId === "string"
      ? body.providerId.trim().toLowerCase()
      : "";
    const knownProvider = findSocialsManagerProvider(providerId);
    const connection = (await session.client.listProviderConnections()).find(
      (provider) => provider.identifier === providerId,
    );
    if (!knownProvider || !connection) {
      return NextResponse.json({ ok: false, error: "Unknown Postiz provider." }, { status: 400 });
    }

    if (action === "authorize") {
      if (connectionMode(connection) !== "oauth") {
        return NextResponse.json(
          { ok: false, error: `${knownProvider.name} uses a guided connection form.` },
          { status: 409 },
        );
      }
      const url = await session.client.createConnectionUrl(providerId);
      if (!/^https?:\/\//i.test(url) || /(?:undefined|null)(?:[&#/]|$)/i.test(url)) {
        return NextResponse.json(
          {
            ok: false,
            error: `${knownProvider.name} needs its OAuth app credentials in the Postiz service configuration.`,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, url });
    }

    if (action === "credentials") {
      const fields = fieldsFor(connection);
      if (!fields.length || connectionMode(connection) !== "credentials") {
        return NextResponse.json(
          { ok: false, error: `${knownProvider.name} does not accept credentials here.` },
          { status: 409 },
        );
      }
      const rawValues = body.values && typeof body.values === "object" && !Array.isArray(body.values)
        ? body.values as Record<string, unknown>
        : {};
      const values: Record<string, string> = {};
      for (const field of fields) {
        const rawValue = rawValues[field.key];
        const value = typeof rawValue === "string"
          ? rawValue.trim()
          : field.defaultValue?.trim() ?? "";
        if (!value) {
          return NextResponse.json(
            { ok: false, error: `${field.label} is required.` },
            { status: 400 },
          );
        }
        if (value.length > 8_192) {
          return NextResponse.json({ ok: false, error: `${field.label} is too long.` }, { status: 400 });
        }
        values[field.key] = value;
      }

      const state = await session.client.createConnectionUrl(providerId);
      const code = connection.customFields.length
        ? Buffer.from(JSON.stringify(values), "utf8").toString("base64")
        : providerId === "telegram"
          ? values.channel
          : values.apiKey;
      const rawTimezone = typeof body.timezone === "number" ? body.timezone : 0;
      const timezone = Math.max(-840, Math.min(840, Math.round(rawTimezone)));
      await session.client.completeConnection({ providerId, state, code, timezone });
      return NextResponse.json(present(await liveSettings(userId), draftingNetworks(userId)));
    }

    return NextResponse.json({ ok: false, error: "Unknown settings action." }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    return responseForError(error);
  }
}
