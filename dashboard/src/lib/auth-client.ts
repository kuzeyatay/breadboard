import { signOut } from "next-auth/react";
import { desktopTabsBridge } from "./desktop-browser-tabs";
export { authReturnPath } from "./auth-navigation";

import { AUTH_CHANGED_EVENT } from './auth-events';
export { AUTH_CHANGED_EVENT } from './auth-events';

export async function synchronizeDesktopAuthentication(): Promise<boolean> {
  const desktop = desktopTabsBridge();
  if (!desktop) return false;
  try { return await desktop.tabs({ type: "auth-sync" }); }
  catch { return false; }
}

export async function signOutOfWorkspace(): Promise<void> {
  await signOut({ redirect: false });
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  if (!await synchronizeDesktopAuthentication()) window.location.replace("/auth/login");
}
