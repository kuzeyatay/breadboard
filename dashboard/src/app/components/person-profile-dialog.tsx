"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { PersonProfile } from "@/lib/profile/person-profile.ts";

/**
 * Someone else, in a popup.
 *
 * Looking at a colleague is a glance taken in passing — from a garden card that
 * says who shared it, or from the member list of an organization. Sending the
 * page away for that loses the place the glance was taken from, so this opens
 * over it instead and closes back onto it. Only the gardens go anywhere: those
 * are a real destination, and the popup gets out of the way when one is picked.
 */
export default function PersonProfileDialog({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callers key this component by handle, so a different person is a fresh
  // mount and the state starts empty rather than needing a reset here.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(username)}`);
        const body = (await response.json().catch(() => ({}))) as {
          profile?: PersonProfile;
          error?: string;
        };
        if (!live) return;
        if (!response.ok || !body.profile) {
          setError(body.error ?? "Could not read that profile.");
          return;
        }
        setProfile(body.profile);
      } catch {
        if (live) setError("Could not read that profile.");
      }
    })();
    return () => {
      live = false;
    };
  }, [username]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${username}'s profile`}
        className="bb-modal-panel neu-dialog w-full max-w-lg rounded-2xl border border-gray-800 p-5 text-[var(--ink)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">
              {profile?.username ?? username}
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              {error
                ? " "
                : profile
                  ? [
                      `Here since ${profile.joined}`,
                      profile.sharedOrganizations.length > 0
                        ? `with you in ${profile.sharedOrganizations.join(", ")}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Loading…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition hover:border-gray-700 hover:text-gray-200"
            aria-label="Close profile"
            title="Close"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        ) : profile?.isViewer ? (
          <div className="mt-4">
            <p className="text-xs text-gray-600">This is you.</p>
            <Link
              href="/profile"
              onClick={onClose}
              className="neu-button mt-3 inline-flex items-center rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
            >
              Open your profile
            </Link>
          </div>
        ) : (
          <section className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-white">Shared gardens</h3>
            {profile === null ? (
              <p className="text-xs text-gray-600">Loading…</p>
            ) : profile.gardens.length === 0 ? (
              <p className="text-xs text-gray-600">
                {profile.username} has not shared any garden you can open.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {profile.gardens.map((garden) => (
                  <li
                    key={garden.slug}
                    className="neu-surface rounded-lg border border-gray-800 px-3 py-2"
                  >
                    <Link
                      href={`/garden/${garden.slug}`}
                      onClick={onClose}
                      className="flex items-center gap-3 text-sm text-gray-200 transition-colors hover:text-white"
                    >
                      <span className="min-w-0 flex-1 truncate">{garden.name}</span>
                      <span className="shrink-0 text-[11px] text-gray-600">
                        {garden.visibility === "organization"
                          ? (garden.organizationName ?? "organization")
                          : "public"}
                      </span>
                    </Link>
                    {garden.description && (
                      <p className="mt-1 truncate text-xs text-gray-600">
                        {garden.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
