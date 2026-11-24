import type { OfficeKindInfo } from "@/lib/office/types";
import styles from "./spaces.module.css";

const WHITEBOARD = { badge: "◇", color: "#4b5fd6" };

export default function SpacesFileBadge({ info, whiteboard, size = 30 }: {
  info: OfficeKindInfo;
  whiteboard?: boolean;
  size?: number;
}) {
  const { badge, color } = whiteboard ? WHITEBOARD : info;
  // The text presentation selector on the play triangle adds no visible character.
  const multipleCharacters = badge.replace(/\uFE0E/g, "").length > 1;
  return (
    <span
      aria-hidden="true"
      className={styles.badge}
      style={{ backgroundColor: color, width: size, height: size, fontSize: size * (multipleCharacters ? 0.3 : 0.45) }}
    >
      {badge}
    </span>
  );
}
