import type { Metadata } from "next";
import { IBM_Plex_Mono, Schibsted_Grotesk, Source_Sans_3 } from "next/font/google";
import { Suspense } from "react";
import AppThemeRuntime from "@/app/components/app-theme-runtime";
import DesktopTitleBar from "@/app/components/desktop-title-bar";
import { interactionHydrationBootstrapScript } from "@/app/components/interaction-hydration-bridge";
import InteractionHydrationGate from "@/app/components/interaction-hydration-gate";
import NavigationProgress from "@/app/components/navigation-progress";
import NavigationTrail from "@/app/components/navigation-trail";
import RecallAutoStart from "@/app/components/recall-autostart";
import "./globals.css";
import "katex/dist/katex.min.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const themeInitializationScript = `try{const theme=localStorage.getItem("breadboard:theme");if(theme==="dark")document.documentElement.dataset.theme="dark"}catch{}`;

/**
 * Electron's preload exposes `window.breadboardDesktop` before any page script
 * runs, so the desktop flag belongs here rather than in a client effect. It has
 * to be set before the first paint: the native caption buttons are painted by
 * the window itself from the moment it loads, while the 32px strip that reserves
 * room for them — and the `calc(100vh - …)` height on every page shell — only
 * exists once this attribute does. Setting it after hydration made the whole app
 * shove down a row a few frames into every refresh.
 */
const desktopChromeScript = `try{if("breadboardDesktop" in window)document.documentElement.dataset.breadboardDesktop="true"}catch{}`;

export const metadata: Metadata = {
  title: "breadboard",
  description: "breadboard — your personal knowledge garden",
  icons: {
    icon: [
      { url: "/breadboard-favicon-20260426.ico", sizes: "any" },
      { url: "/breadboard-icon-20260426.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      {
        url: "/breadboard-apple-icon-20260426.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${schibsted.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
        <script dangerouslySetInnerHTML={{ __html: desktopChromeScript }} />
        <script dangerouslySetInnerHTML={{ __html: interactionHydrationBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppThemeRuntime />
        <RecallAutoStart />
        <DesktopTitleBar />
        <Suspense fallback={null}>
          <NavigationProgress />
          <NavigationTrail />
        </Suspense>
        <InteractionHydrationGate>{children}</InteractionHydrationGate>
      </body>
    </html>
  );
}
