"use client";

import { useState, type ReactNode } from "react";
import { signOutOfWorkspace } from "@/lib/auth-client";

export default function SignOutButton({ children, className }: { children: ReactNode; className?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <>
    <button type="button" className={className} disabled={pending} onClick={async () => {
      if (pending) return;
      setPending(true);
      setError(false);
      try { await signOutOfWorkspace(); }
      catch { setError(true); setPending(false); }
    }}>{pending ? "Signing out…" : children}</button>
    {error && <span role="alert" className="text-sm text-red-400">Could not sign out. Please try again.</span>}
  </>;
}
