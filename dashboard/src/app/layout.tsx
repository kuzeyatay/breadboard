import type { Metadata } from "next";
import { IBM_Plex_Mono, Schibsted_Grotesk, Source_Sans_3 } from "next/font/google";
import { Suspense } from "react";
import DesktopTitleBar from "@/app/components/desktop-title-bar";
import NavigationProgress from "@/app/components/navigation-progress";
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
    >
      <body className="min-h-full flex flex-col">
        <DesktopTitleBar />
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
