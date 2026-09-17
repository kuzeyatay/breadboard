"use client";

import { useEffect, useState } from "react";
import { useGreetingTypewriter } from "@/app/components/use-greeting-typewriter";
import styles from "./browser-private.module.css";

const GREETINGS = [
  "Whatcha watchin’?",
  "For research, obviously.",
  "Ah yes, ‘research’.",
  "Nice disguise.",
  "Incognito, big curiosity.",
  "Shopping for ‘a friend’?",
  "Another secret side quest?",
  "Very mysterious of you.",
  "Cue the spy music.",
  "Fake moustache optional.",
  "Plotting a surprise party?",
  "Your alter ego has tabs.",
  "What’s the cover story?",
  "Curiosity wore sunglasses.",
  "Nothing to see here. Yet.",
  "Welcome, Agent Tab.",
] as const;

export default function PrivateBrowserGreeting() {
  const [greeting, setGreeting] = useState("");
  const { displayed, animating } = useGreetingTypewriter(greeting);

  useEffect(() => {
    // Keep the selection in memory; private greetings need no account signals
    // or saved history. Each visit gets a fresh pick, then rotates hourly.
    let previous = "";
    const rotate = () => {
      const available = GREETINGS.filter((line) => line !== previous);
      previous = available[Math.floor(Math.random() * available.length)];
      setGreeting(previous);
    };
    const frame = window.requestAnimationFrame(rotate);
    const timer = window.setInterval(rotate, 60 * 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className={`browser-greeting ${greeting ? "is-ready" : ""} ${styles.greeting}`} data-animating={animating}>
      <h1>
        <span className="sr-only">{greeting}</span>
        <span aria-hidden="true">
          {displayed || "\u00a0"}
          {animating ? <span className="browser-greeting-caret" /> : null}
        </span>
      </h1>
    </div>
  );
}
