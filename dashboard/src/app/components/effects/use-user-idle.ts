"use client";

import { useEffect, useSyncExternalStore } from "react";
import { serverUserIdle, subscribeUserIdle, userIdle, wakeUser } from "@/lib/user-idle";

/** True once this window has had no input for a minute; see `@/lib/user-idle`. */
export function useUserIdle() {
  useEffect(() => wakeUser(), []);
  return useSyncExternalStore(subscribeUserIdle, userIdle, serverUserIdle);
}

/** Mounted once in the root layout so every page keeps `html[data-user-idle]` current. */
export function UserIdleRuntime() {
  useUserIdle();
  return null;
}
