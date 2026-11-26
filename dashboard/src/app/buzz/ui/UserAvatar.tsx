"use client";

import * as React from "react";

import { parseAnimatedAvatarUrl } from "@/app/buzz/lib/animatedAvatar";
import { cn } from "@/app/buzz/lib/cn";
import { getInitials } from "@/app/buzz/lib/initials";
import { rewriteRelayUrl } from "@/app/buzz/lib/mediaUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/buzz/ui/avatar";
import { DEFAULT_AVATAR_SRC } from "@/app/components/default-avatar";

type UserAvatarSize = "xs" | "sm" | "md";

const sizeClasses: Record<UserAvatarSize, string> = {
  xs: "h-5 w-5 text-3xs",
  sm: "h-6 w-6 text-2xs",
  md: "h-9 w-9 text-xs",
};

type UserAvatarProps = {
  avatarUrl: string | null;
  displayName: string;
  size?: UserAvatarSize;
  /** Kept for callers; every placeholder is now the same Crumbs face. */
  accent?: boolean;
  className?: string;
  fallbackDelayMs?: number;
  testId?: string;
};

export function UserAvatar({
  avatarUrl,
  displayName,
  size = "md",
  className,
  fallbackDelayMs,
  testId,
}: UserAvatarProps) {
  const initials = getInitials(displayName);
  // Animated avatars show their static poster frame until hovered, then play
  // the animation.
  const animated = parseAnimatedAvatarUrl(avatarUrl);
  const [isHovered, setIsHovered] = React.useState(false);
  const src = animated
    ? rewriteRelayUrl(isHovered ? animated.animationUrl : animated.posterUrl)
    : avatarUrl
      ? rewriteRelayUrl(avatarUrl)
      : null;

  return (
    <Avatar
      // Animated avatars carry their own backdrop disc and transparent
      // surroundings — any container fill would flatten the pop-out.
      className={cn(sizeClasses[size], !animated && "shadow-xs", className)}
      onMouseEnter={animated ? () => setIsHovered(true) : undefined}
      onMouseLeave={animated ? () => setIsHovered(false) : undefined}
    >
      {src ? (
        <AvatarImage
          alt={`${displayName} avatar`}
          className={cn("object-cover", !animated && "bg-secondary")}
          data-testid={testId ? `${testId}-image` : undefined}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
      {/* No photo: the Crumbs default face, the same one every other surface shows. */}
      <AvatarFallback
        aria-label={initials ? `${displayName} avatar` : undefined}
        className="bg-cover bg-center"
        style={{ backgroundImage: `url("${DEFAULT_AVATAR_SRC}")` }}
        data-testid={testId ? `${testId}-fallback` : undefined}
        delayMs={fallbackDelayMs}
      />
    </Avatar>
  );
}
