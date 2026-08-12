import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import PaintPomodoro from "@/app/components/paint-pomodoro";

// Newsreader ≈ the Met serif used by PaintPomodoro; Source Sans 3 is already
// loaded app-wide for the sans face.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
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
