import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import AmbientFrameGovernorRuntime from "@/app/components/ambient-frame-governor-runtime";
import AppThemeRuntime from "@/app/components/app-theme-runtime";
import EnterSubmitRuntime from "@/app/components/enter-submit-runtime";
import { UserIdleRuntime } from "@/app/components/effects/use-user-idle";
import AnchoredTabNavigationGuard from "@/app/components/anchored-tab-navigation-guard";
import AuthenticationSync from "@/app/components/authentication-sync";
import CurrentLocationAutoRefresh from "@/app/components/current-location-autorefresh";
import DesktopTitleBar from "@/app/components/desktop-title-bar";
import { chunkRecoveryScript } from "@/app/components/chunk-recovery";
import { interactionHydrationBootstrapScript } from "@/app/components/interaction-hydration-bridge";
import InteractionHydrationGate from "@/app/components/interaction-hydration-gate";
import NavigationProgress from "@/app/components/navigation-progress";
import NavigationTrail from "@/app/components/navigation-trail";
import PdfSaveStatus from "@/app/components/pdf-save-status";
import RecallAutoStart from "@/app/components/recall-autostart";
import ChatgptWebTabAgent from "@/app/components/chatgpt-web-tab-agent";
import ClapListenerProvider from "@/app/components/clap-listener-provider";
import VoiceAssistantBrowserHost from "@/app/components/voice-assistant-browser-host";
import "./globals.css";
import "katex/dist/katex.min.css";

// Keep startup/rebuilds independent of Google Fonts availability.
const sourceSans = localFont({
  src: "./fonts/sourcesans3/SourceSans3[wght].ttf",
  variable: "--font-source-sans",
  weight: "200 900",
  style: "normal",
  display: "swap",
});

const schibsted = localFont({
  src: "./fonts/schibstedgrotesk/SchibstedGrotesk[wght].ttf",
  variable: "--font-schibsted",
  weight: "400 900",
  style: "normal",
  display: "swap",
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibmplexmono/IBMPlexMono-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/ibmplexmono/IBMPlexMono-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/ibmplexmono/IBMPlexMono-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/ibmplexmono/IBMPlexMono-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  adjustFontFallback: false,
});

/**
 * Choose the theme before the first paint.
 *
 * The desktop dashboard is served from a loopback port that can change between
 * launches, so a new launch can have a fresh origin and therefore no
 * localStorage yet—or can reuse a port whose origin contains an older choice.
 * The shell appends its durable, last-active theme to the launch URL, so that
 * value is authoritative when present and seeds the origin before first paint.
 * In-page theme changes keep the launch URL current for renderer-only reloads.
 */
const themeInitializationScript = `(()=>{const key="breadboard:theme";const launch=new URLSearchParams(location.search).get("theme");let theme=launch==="dark"||launch==="light"?launch:null;if(!theme){try{const stored=localStorage.getItem(key);if(stored==="dark"||stored==="light")theme=stored}catch{}}if(theme){try{localStorage.setItem(key,theme)}catch{}document.documentElement.dataset.theme=theme}})()`;

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
      data-breadboard-startup="loading"
      className={`${sourceSans.variable} ${schibsted.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
        <script dangerouslySetInnerHTML={{ __html: desktopChromeScript }} />
        <script dangerouslySetInnerHTML={{ __html: chunkRecoveryScript }} />
        <script dangerouslySetInnerHTML={{ __html: interactionHydrationBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppThemeRuntime />
        <EnterSubmitRuntime />
        <UserIdleRuntime />
        <AmbientFrameGovernorRuntime />
        <AuthenticationSync />
        <AnchoredTabNavigationGuard />
        <CurrentLocationAutoRefresh />
        <RecallAutoStart />
        <ChatgptWebTabAgent />
        <DesktopTitleBar />
        <PdfSaveStatus />
        <Suspense fallback={null}>
          <NavigationProgress />
          <NavigationTrail />
          <ClapListenerProvider />
          <VoiceAssistantBrowserHost />
        </Suspense>
        <InteractionHydrationGate>{children}</InteractionHydrationGate>
      </body>
    </html>
  );
}
