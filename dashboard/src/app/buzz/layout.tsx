import type { Metadata } from "next";
import type { ReactNode } from "react";

// The vendored Buzz theme. Every rule inside is scoped to `.buzz-root`, so
// importing it here costs the rest of the app nothing but keeps the page's
// look in one reviewable file.
import "./buzz-theme.css";
import "./ui/card-texture.css";

export const metadata: Metadata = {
  title: "Buzz — breadboard",
  description: "Rooms where you and your agents work in one shared transcript.",
};

export default function BuzzLayout({ children }: { children: ReactNode }) {
  return children;
}
