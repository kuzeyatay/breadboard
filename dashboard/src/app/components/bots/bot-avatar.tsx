"use client";

import { BotAvatar as Avatar } from "bot-avatars";
import { useSyncExternalStore } from "react";
import type { BotAvatarConfig } from "@/lib/bots/types";
import { useSurfaceTheme } from "../effects/use-surface-theme";

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotion = () => window.matchMedia(motionQuery).matches;

export default function BotAvatar({ avatar, name, state = "default", size = 48, paused = false }: {
  avatar: BotAvatarConfig; name: string; state?: "default" | "working" | "sleeping"; size?: number; paused?: boolean;
}) {
  const theme = useSurfaceTheme();
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => true);
  const still = paused || reduce;
  return <Avatar key={still ? `still-${state}` : "live"} type={avatar.shape} color={avatar.color} face={avatar.face}
    state={state} size={size} paused={still} interactive={false} jumpEvery={0}
    theme={theme ?? "auto"} aria-label={`${name}, ${state === "working" ? "working" : state === "sleeping" ? "resting" : "ready"}`}
    data-bot-avatar={avatar.shape} data-bot-state={state} data-bot-paused={still} style={{ flex: "none", alignSelf: "center" }} />;
}
