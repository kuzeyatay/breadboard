import type { HermesSurface } from "./config.ts";

/** Phone delivery changes presentation, not the owner's saved authority. */
export function turnApprovalPolicy(input: {
  surface: HermesSurface;
  deliveryChannel?: "telegram" | "whatsapp";
  yoloMode?: boolean;
  savedYoloMode?: boolean;
}) {
  const privateSurface = input.surface === "dashboard_terminal" || input.surface === "garden_chat";
  const yoloMode = privateSurface && (input.yoloMode ??
    (Boolean(input.deliveryChannel) && input.savedYoloMode === true));
  const interactive = !input.deliveryChannel;
  return {
    yoloMode,
    interactive,
    // A standing approval works even when no permission widget can be shown.
    interactiveApprovals: privateSurface && (interactive || yoloMode),
  };
}
