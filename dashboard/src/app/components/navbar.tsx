'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import type { ReactNode } from 'react';
import BreadboardLogo from './breadboard-logo';

interface Props {
  email: string;
  username?: string | null;
  actions?: ReactNode;
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function NavBar({ email, username, actions }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function openInviteModal() {
    setInviteOpen(true);
    setInviteCode('');
    setInviteError(null);
    setCopied(false);
  }

  async function createInvite() {
    setInviteLoading(true);
    setInviteError(null);
    setInviteCode('');
    setCopied(false);

    try {
      const res = await fetch('/api/invites', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.code !== 'string') {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not create invite');
      }
      setInviteCode(data.code);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInvite() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setInviteError('Could not copy invite');
    }
  }

  return (
    <>
      <nav className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        <span className="flex items-center gap-2">
          <BreadboardLogo className="w-5 h-4 text-white" />
          <span className="text-sm font-semibold text-white tracking-tight">breadboard</span>
        </span>
        <div className="flex items-center gap-4">
          {actions}
          <button
            onClick={openInviteModal}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Invite
          </button>
          <span className="text-xs text-gray-500 truncate max-w-[240px]" title={email}>
            {username || email}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            className="text-xs text-gray-500 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setInviteOpen(false); }}
        >
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-white">Invite someone</h2>
              <p className="text-sm text-gray-500 mt-1">Create a one-time code for a new account.</p>
            </div>

            {inviteCode ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Invite code</label>
                  <div className="flex gap-2">
                    <input
                      value={inviteCode}
                      readOnly
                      className="min-w-0 flex-1 bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={copyInvite}
                      className="px-4 py-2.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={createInvite}
                    disabled={inviteLoading}
                    className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {inviteLoading && <Spinner />}
                    {inviteLoading ? 'Creating...' : 'Create another'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createInvite}
                    disabled={inviteLoading}
                    className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {inviteLoading && <Spinner />}
                    {inviteLoading ? 'Creating...' : 'Create invite'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
