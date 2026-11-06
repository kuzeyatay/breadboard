import { session, type Session } from "electron";

/** Call immediately after app readiness, before anything uses the default session.
 * Electron cannot change a session's cache policy after its first creation. */
export function initializeAppSession(): Session {
  // Local tabs share immutable Next.js chunks. A suspended/restored tab can
  // hold a cache entry open and leave every other reader at HTTP_CACHE_ADD_TO_ENTRY,
  // preventing hydration (PDFs stay on "Opening PDF"). The separate app-assets
  // transport caches completed immutable files without Chromium's entry locks.
  // The empty partition preserves the existing default session's cookies and
  // storage. Website tabs use a separate partition and keep normal HTTP caching.
  return session.fromPartition("", { cache: false });
}
