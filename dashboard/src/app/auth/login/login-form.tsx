'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { authReturnPath, completeSignIn } from '@/lib/auth-client';
import { Avatar, PasswordField } from './password-field';

function returnPath() {
  return authReturnPath(new URLSearchParams(window.location.search).get('callbackUrl'), window.location.origin);
}

/** The lock screen. With the startup password off, it signs straight in. */
export default function LoginForm({ name, auto }: { name: string; auto: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auto) return;
    const callbackUrl = returnPath();
    void signIn('credentials', { auto: '1', redirect: false, callbackUrl })
      .then((result) => { if (result?.ok && !result.error) return completeSignIn(callbackUrl); })
      .catch(() => {});
  }, [auto]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const password = new FormData(e.currentTarget).get('password') as string;
    try {
      const callbackUrl = returnPath();
      const result = await signIn('credentials', { password, redirect: false, callbackUrl });
      if (!result?.ok || result.error) {
        setError('Wrong password.');
        setLoading(false);
        return;
      }
      await completeSignIn(callbackUrl);
    } catch {
      setError('Could not sign in. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--paper-surface)] flex items-center justify-center px-4">
      <div className="neu-surface-raised w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-7">
        <Avatar name={name} />
        <h1 className="text-2xl font-semibold text-white text-center mb-8 tracking-tight">{name}</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField id="password" label="Password or PIN" autoComplete="current-password" autoFocus />
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="neu-button-primary w-full mt-2 rounded-lg bg-white text-gray-950 font-medium text-sm py-2.5 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
