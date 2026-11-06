import type { Metadata } from "next";
import localFont from "next/font/local";
import PaintPomodoro from "@/app/components/paint-pomodoro";

// Newsreader ≈ the Met serif used by PaintPomodoro; Source Sans 3 is already
// loaded app-wide for the sans face.
const newsreader = localFont({
  src: [
    { path: "../fonts/newsreader/Newsreader[opsz,wght].ttf", weight: "200 800", style: "normal" },
    { path: "../fonts/newsreader/Newsreader-Italic[opsz,wght].ttf", weight: "200 800", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "Paint Pomodoro",
  description: "A focus timer that slowly reveals a masterpiece as you work.",
};

export default function PomodoroPage() {
  return (
    <main className={`${newsreader.variable} relative flex-1`}>
      <PaintPomodoro />
    </main>
  );
}
