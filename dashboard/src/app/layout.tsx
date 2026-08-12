import type { Metadata } from "next";
import { IBM_Plex_Mono, Schibsted_Grotesk, Source_Sans_3 } from "next/font/google";
import { Suspense } from "react";
import AppThemeRuntime from "@/app/components/app-theme-runtime";
import DesktopTitleBar from "@/app/components/desktop-title-bar";
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
      </head>
      <body className="min-h-full flex flex-col">
        <AppThemeRuntime />
        <RecallAutoStart />
        <DesktopTitleBar />
        <Suspense fallback={null}>
          <NavigationProgress />
          <NavigationTrail />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
