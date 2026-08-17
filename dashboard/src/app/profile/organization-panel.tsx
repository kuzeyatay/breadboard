"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import PersonProfileDialog from "@/app/components/person-profile-dialog.tsx";
import type {
  Organization,
  OrganizationRole,
  ReceivedInvite,
} from "@/lib/organizations/types.ts";

const ROLES: OrganizationRole[] = ["member", "admin", "owner"];

function can(role: OrganizationRole, minimum: "admin" | "owner"): boolean {
  if (minimum === "owner") return role === "owner";
  return role === "owner" || role === "admin";
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * Everything about the organizations this account is in: the invites waiting
 * for an answer, the people already inside, and the controls for whoever runs
 * them. One fetch keeps all of it, and every action re-reads it, since these
 * lists are small and any change can move more than one of them.
 */
export default function OrganizationPanel({
  username,
}: {
  username: string;
}) {
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [invites, setInvites] = useState<ReceivedInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [inviteHandle, setInviteHandle] = useState<Record<number, string>>({});
  const [confirmLeave, setConfirmLeave] = useState<number | null>(null);
  // The member whose profile is open over this page, if any.
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/organizations");
      const data = (await response.json().catch(() => ({}))) as {
        organizations?: Organization[];
        invites?: ReceivedInvite[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load organizations");
      setOrganizations(data.organizations ?? []);
      setInvites(data.invites ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load organizations");
      setOrganizations([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (input: RequestInfo, init: RequestInit, fallback: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(input, init);
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error || fallback);
        await load();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  async function create() {
    if (!newName.trim()) return;
    const ok = await act(
      "/api/organizations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      },
      "Could not create the organization",
    );
    if (ok) setNewName("");
  }

  async function invite(organizationId: number) {
    const handle = (inviteHandle[organizationId] ?? "").trim();
    if (!handle) return;
    const ok = await act(
      `/api/organizations/${organizationId}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, role: "member" }),
      },
      "Could not send the invite",
    );
    if (ok) {
      setInviteHandle((current) => ({ ...current, [organizationId]: "" }));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {invites.length > 0 && (
        <Section title="Invitations" hint="Someone wants you in their organization.">
          <ul className="space-y-1.5">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="neu-surface flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-white">
                  {invite.organizationName}
                  {invite.invitedBy && (
                    <span className="text-gray-500"> from {invite.invitedBy}</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      "/api/organizations/invites",
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ inviteId: invite.id, accept: true }),
                      },
                      "Could not accept the invite",
                    )
                  }
                  className="neu-button shrink-0 rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-40"
                >
                  Join
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      "/api/organizations/invites",
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ inviteId: invite.id, accept: false }),
                      },
                      "Could not decline the invite",
                    )
                  }
                  className="shrink-0 text-[11px] text-gray-500 transition-colors hover:text-white disabled:opacity-40"
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {organizations === null ? (
        <Section title="Organizations">
          <p className="text-xs text-gray-600">Loading…</p>
        </Section>
      ) : (
        organizations.map((organization) => {
          const isAdmin = can(organization.role, "admin");
          const isOwner = can(organization.role, "owner");
          return (
            <Section
              key={organization.id}
              title={organization.name}
              hint={`${organization.members.length} ${organization.members.length === 1 ? "person" : "people"} · you are ${organization.role === "owner" ? "the owner" : `${organization.role === "admin" ? "an admin" : "a member"}`}`}
            >
              <ul className="space-y-1.5">
                {organization.members.map((member) => (
                  <li
                    key={member.userId}
                    className="neu-surface flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
                  >
                    {member.username === username ? (
                      <Link
                        href="/profile"
                        className="min-w-0 flex-1 truncate text-left text-sm text-gray-200 transition-colors hover:text-white"
                      >
                        {member.username}
                        <span className="text-gray-600"> (you)</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenPerson(member.username)}
                        className="min-w-0 flex-1 truncate text-left text-sm text-gray-200 transition-colors hover:text-white"
                      >
                        {member.username}
                      </button>
                    )}

                    {isAdmin && member.role !== "owner" ? (
                      <select
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          act(
                            `/api/organizations/${organization.id}/members`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                userId: member.userId,
                                role: event.target.value,
                              }),
                            },
                            "Could not change that role",
                          )
                        }
                        className="neu-control shrink-0 rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-gray-300 outline-none transition-colors focus:border-gray-600"
                      >
                        {ROLES.filter((role) => role !== "owner" || isOwner).map(
                          (role) => (
                            <option key={role} value={role}>
                              {role === "owner" ? "hand over" : role}
                            </option>
                          ),
                        )}
                      </select>
                    ) : (
                      <span className="shrink-0 text-[11px] text-gray-500">
                        {member.role}
                      </span>
                    )}

                    {isAdmin && member.role !== "owner" && member.username !== username && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(
                            `/api/organizations/${organization.id}/members?userId=${member.userId}`,
                            { method: "DELETE" },
                            "Could not remove that person",
                          )
                        }
                        className="shrink-0 text-[11px] text-gray-600 transition-colors hover:text-red-400 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {organization.invites.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {organization.invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center gap-3 rounded-lg border border-dashed border-gray-800 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-500">
                        {invite.username}
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-600">invited</span>
                      {isAdmin && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act(
                              `/api/organizations/invites?inviteId=${invite.id}`,
                              { method: "DELETE" },
                              "Could not withdraw the invite",
                            )
                          }
                          className="shrink-0 text-[11px] text-gray-600 transition-colors hover:text-white disabled:opacity-40"
                        >
                          Withdraw
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {isAdmin && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={inviteHandle[organization.id] ?? ""}
                    onChange={(event) =>
                      setInviteHandle((current) => ({
                        ...current,
                        [organization.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void invite(organization.id);
                    }}
                    placeholder="Username or email"
                    className="neu-control min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-gray-600"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => invite(organization.id)}
                    className="neu-button shrink-0 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-40"
                  >
                    Invite
                  </button>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                {confirmLeave === organization.id ? (
                  <>
                    <span className="text-xs text-gray-400">
                      {isOwner && organization.members.length === 1
                        ? "Delete this organization?"
                        : "Leave this organization?"}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setConfirmLeave(null);
                        await act(
                          `/api/organizations/${organization.id}/members`,
                          { method: "DELETE" },
                          "Could not leave",
                        );
                      }}
                      className="text-xs font-medium text-red-500 transition-colors hover:text-red-400 disabled:opacity-40"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(null)}
                      className="text-xs text-gray-500 transition-colors hover:text-white"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(organization.id)}
                    className="text-xs text-gray-600 transition-colors hover:text-white"
                  >
                    {isOwner && organization.members.length === 1
                      ? "Delete organization"
                      : "Leave organization"}
                  </button>
                )}
              </div>
            </Section>
          );
        })
      )}

      <Section
        title="New organization"
        hint="You run whatever you create, and can invite anyone with an account."
      >
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
            placeholder="Name"
            className="neu-control min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors focus:border-gray-600"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={create}
            className="neu-button-primary shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </Section>

      {openPerson && (
        <PersonProfileDialog
          key={openPerson}
          username={openPerson}
          onClose={() => setOpenPerson(null)}
        />
      )}
    </div>
  );
}
