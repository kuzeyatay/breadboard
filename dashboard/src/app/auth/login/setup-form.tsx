'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { authReturnPath, completeSignIn } from '@/lib/auth-client';
import { PasswordField, fieldClass } from './password-field';

/** The first time Breadboard opens: a name and a password or PIN. */
export default function SetupForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = form.get('password') as string;
    if (password !== form.get('confirm')) {
      setError('These don’t match.');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({})) ?? {};
      setError(data.error ?? 'Something went wrong. Try again.');
      setLoading(false);
      return;
    }
    const callbackUrl = authReturnPath(new URLSearchParams(window.location.search).get('callbackUrl'), window.location.origin);
    const result = await signIn('credentials', { password, redirect: false, callbackUrl });
    if (!result?.ok || result.error) {
      window.location.replace('/auth/login');
      return;
    }
    await completeSignIn(callbackUrl);
  }

  return (
    <div className="min-h-screen bg-[var(--paper-surface)] flex items-center justify-center px-4">
      <div className="neu-surface-raised w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-7">
        <h1 className="text-2xl font-semibold text-white text-center mb-8 tracking-tight">Welcome to Breadboard</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Your name"
            placeholder="Your name"
            className={fieldClass}
          />
          <PasswordField id="password" label="Password or PIN" autoComplete="new-password" />
          <PasswordField id="confirm" label="Confirm" autoComplete="new-password" />
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="neu-button-primary w-full mt-2 rounded-lg bg-white text-gray-950 font-medium text-sm py-2.5 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
