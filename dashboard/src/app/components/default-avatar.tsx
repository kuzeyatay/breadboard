"use client";

import { useState, type CSSProperties } from "react";

/**
 * The one picture for anything without a photo of its own: a Crumbs profile,
 * an organization, an organization's workspace. The same image is the
 * placeholder behind a real photo while it loads or if it fails, so every
 * surface shows one default and never a blank disc or a stray initial.
 */
export const DEFAULT_AVATAR_SRC = "/avatars/default.svg";
export const BREAD_AVATAR_SRC = "/avatars/bread.svg";

export default function DefaultAvatar({
  src,
  name,
  size = 32,
  shape = "circle",
  className,
}: {
  src?: string | null;
  /** Read aloud; the picture itself is decorative. */
  name?: string;
  size?: number;
  shape?: "circle" | "rounded";
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && failed !== src ? src : null;
  const style: CSSProperties = {
    width: size,
    height: size,
    flex: "none",
    display: "inline-block",
    overflow: "hidden",
    borderRadius: shape === "circle" ? "9999px" : Math.round(size * 0.28),
    backgroundImage: `url("${DEFAULT_AVATAR_SRC}")`,
    backgroundSize: "cover",
  };
  return (
    <span className={className} style={style} role={name ? "img" : undefined} aria-label={name} aria-hidden={name ? undefined : true}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote profile photos of any origin
        <img src={photo} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={() => setFailed(photo)} />
      ) : null}
    </span>
  );
}

/**
 * A person's colour in a shared workspace chat. Never green: green is the
 * reader's own bubble everywhere else in Breadboard.
 */
const PERSON_COLORS = ["#8839ef", "#1e66f5", "#d20f39", "#fe640b", "#df8e1d", "#209fb5", "#ea76cb", "#7287fd"];

export function personColor(name: string): string {
  let hash = 0;
  for (const character of name.trim().toLowerCase()) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return PERSON_COLORS[hash % PERSON_COLORS.length];
}

/** A person in a shared workspace chat: the Crumbs default face, like everywhere else. */
export function PersonAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return <DefaultAvatar name={name} size={size} />;
}
