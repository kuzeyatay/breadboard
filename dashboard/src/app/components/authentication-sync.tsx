"use client";

import { useEffect } from "react";
import { authReturnPath, AUTH_CHANGED_EVENT, synchronizeDesktopAuthentication } from "@/lib/auth-client";
import { desktopTabsBridge } from "@/lib/desktop-browser-tabs";

/** Browser windows share auth cookies, but their React/router caches do not. */
export default function AuthenticationSync() {
  useEffect(() => {
    if (desktopTabsBridge()) {
      void synchronizeDesktopAuthentication();
      return;
    }
    let disposed = false;
    let previous: string | null | undefined;
    let revision = 0;
    async function reconcile() {
      const request = ++revision;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return;
        const session = await response.json();
        if (disposed || request !== revision) return;
        const userId = session?.user?.id ?? null;
        const location = window.location;
        const login = location.pathname.startsWith("/auth/");
        if (login && userId) {
          location.replace(authReturnPath(new URLSearchParams(location.search).get("callbackUrl"), location.origin));
        } else if (previous !== undefined && previous !== userId) {
          if (userId) location.reload();
          else location.replace(`/auth/login?callbackUrl=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
        }
        previous = userId;
      } catch { /* A connection failure does not mean the user signed out. */ }
    }
    const storage = (event: StorageEvent) => { if (event.key === "nextauth.message") void reconcile(); };
    const visible = () => { if (document.visibilityState === "visible") void reconcile(); };
    window.addEventListener("storage", storage);
    window.addEventListener(AUTH_CHANGED_EVENT, reconcile);
    document.addEventListener("visibilitychange", visible);
    void reconcile();
    return () => {
      disposed = true;
      window.removeEventListener("storage", storage);
      window.removeEventListener(AUTH_CHANGED_EVENT, reconcile);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
