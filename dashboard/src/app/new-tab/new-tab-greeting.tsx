"use client";

import { useGreetingTypewriter } from "@/app/components/use-greeting-typewriter";
import styles from "./new-tab-controls.module.css";

const PREFIX = "Where to, ";

export default function NewTabGreeting({ addressee }: { addressee: string }) {
  const target = `${PREFIX}${addressee}?`;
  // Keep the server-rendered greeting until the contextual nickname is ready.
  const { displayed, animating } = useGreetingTypewriter(target, target);

  return (
    <h1 className={styles.greeting} data-animating={animating}>
      <span className="sr-only">{target}</span>
      <span className={styles.greetingSizer} aria-hidden="true">{target}</span>
      <span className={styles.greetingText} aria-hidden="true">
        {displayed.slice(0, PREFIX.length) || "\u00a0"}
        <span className={styles.addressee}>{displayed.slice(PREFIX.length)}</span>
        {animating ? <span className="browser-greeting-caret" /> : null}
      </span>
    </h1>
  );
}
