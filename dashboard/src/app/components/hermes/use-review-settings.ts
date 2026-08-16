"use client";

// The data half of the spaced-repetition settings, shared by both surfaces that
// show them: the floating garden chat panel and the garden workspace's settings
// dialog. Only the markup differs between those two — the chat panel is dark and
// compact, the dialog uses the neumorphic variable system — so the loading,
// saving and seeding live here rather than being written twice and drifting.

import { useCallback, useEffect, useState } from "react";

import type {
  ReviewChannel,
  ReviewGardenSettings,
  ReviewStats,
  ReviewUserSettings,
} from "@/lib/review/types";

export interface ReviewSettingsPayload {
  garden: ReviewGardenSettings;
  user: ReviewUserSettings;
  stats: ReviewStats;
}

export interface SeedSummary {
  scanned: number;
  created: number;
  refreshed: number;
  unchanged: number;
}

export interface UseReviewSettings {
  data: ReviewSettingsPayload | null;
  available: { whatsapp: boolean; telegram: boolean };
  loading: boolean;
  saving: boolean;
  seeding: boolean;
  error: string | null;
  notice: string;
  /** Per-garden participation and share. */
  patchGarden: (body: { enabled?: boolean; dailyLimit?: number }) => Promise<void>;
  /** Per-user delivery preferences, which apply across every garden. */
  patchUser: (body: {
    channel?: ReviewChannel;
    dailyLimit?: number;
    sendHour?: number;
    desiredRetention?: number;
  }) => Promise<void>;
  seed: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useReviewSettings(gardenSlug: string): UseReviewSettings {
  const [data, setData] = useState<ReviewSettingsPayload | null>(null);
  const [available, setAvailable] = useState({ whatsapp: false, telegram: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const base = `/api/review/gardens/${encodeURIComponent(gardenSlug)}`;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The garden endpoint carries the per-user block too, so the common case
      // is one request; the settings endpoint is only needed for the linked-
      // channel flags, which the garden route does not compute.
      const [gardenResponse, userResponse] = await Promise.all([
        fetch(base),
        fetch("/api/review/settings"),
      ]);
      if (!gardenResponse.ok) throw new Error("Could not load review settings.");
      setData((await gardenResponse.json()) as ReviewSettingsPayload);
      if (userResponse.ok) {
        const payload = (await userResponse.json()) as {
          available?: { whatsapp: boolean; telegram: boolean };
        };
        if (payload.available) setAvailable(payload.available);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load review settings.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchGarden = useCallback(
    async (body: { enabled?: boolean; dailyLimit?: number }) => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch(base, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Could not save that.");
        setData((await response.json()) as ReviewSettingsPayload);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save that.");
      } finally {
        setSaving(false);
      }
    },
    [base],
  );

  const patchUser = useCallback(
    async (body: {
      channel?: ReviewChannel;
      dailyLimit?: number;
      sendHour?: number;
      desiredRetention?: number;
    }) => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch("/api/review/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Could not save that.");
        const payload = (await response.json()) as {
          settings: ReviewUserSettings;
          available: { whatsapp: boolean; telegram: boolean };
        };
        setAvailable(payload.available);
        // Only the user block changed, so the garden block and its counts are
        // kept rather than refetched — the panel must not flash back to empty.
        setData((current) => (current ? { ...current, user: payload.settings } : current));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save that.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const seed = useCallback(async () => {
    setSeeding(true);
    setNotice("");
    setError(null);
    try {
      const response = await fetch(`${base}/seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Could not build cards from this garden.");
      const payload = (await response.json()) as { result: SeedSummary };
      const { scanned, created, refreshed, unchanged } = payload.result;
      setNotice(
        scanned === 0
          ? "No learning pages found in this garden yet."
          : `${scanned} pages · ${created} new, ${refreshed} refreshed, ${unchanged} unchanged.`,
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not build cards.");
    } finally {
      setSeeding(false);
    }
  }, [base, reload]);

  return {
    data,
    available,
    loading,
    saving,
    seeding,
    error,
    notice,
    patchGarden,
    patchUser,
    seed,
    reload,
  };
}
