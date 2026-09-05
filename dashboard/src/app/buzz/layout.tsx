import type { Metadata } from "next";
import type { ReactNode } from "react";

// Buzz sets its whole interface in Inter and its code in JetBrains Mono. The
// vendored stylesheet asks for them by name, so without these the page falls
// back to Segoe UI and every heading and label renders a stroke too light —
// which reads as washed-out text rather than as a missing font.
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

// The vendored Buzz theme. Every rule inside is scoped to `.buzz-root`, so
// importing it here costs the rest of the app nothing but keeps the page's
// look in one reviewable file.
import "./buzz-theme.css";
import "./ui/card-texture.css";
// Breadboard-side adaptations, kept out of the generated sheet.
import "./buzz-host.css";

export const metadata: Metadata = {
  title: "Organization — breadboard",
  description:
    "Rooms where your team and their agents work in one shared transcript.",
};

export default function BuzzLayout({ children }: { children: ReactNode }) {
  return children;
}
