"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserDailyQuote, BROWSER_DAILY_QUOTES } from "./browser-daily-quotes";
import { BrowserSketchOutline } from "./browser-home-widgets";

export function BrowserDailyQuote({ ownerKey }: { ownerKey: string }) {
  const quoteRef = useRef<HTMLElement | null>(null);
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const now = new Date();
      setToday(now);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(schedule, tomorrow.getTime() - now.getTime() + 1_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const daily = useMemo(
    () => (today ? browserDailyQuote(today, ownerKey) : BROWSER_DAILY_QUOTES[0]!),
    [ownerKey, today],
  );
  const compactDaily = useMemo(
    () => (today ? browserDailyQuote(today, ownerKey, 42) : browserDailyQuote(new Date(0), ownerKey, 42)),
    [ownerKey, today],
  );

  return (
    <figure ref={quoteRef} className="browser-daily-quote" aria-label="Daily inspirational quote">
      <BrowserSketchOutline targetRef={quoteRef} index={2} />
      <blockquote className="browser-daily-quote-full">“{daily.quote}”</blockquote>
      <figcaption className="browser-daily-quote-full">— {daily.author}</figcaption>
      <blockquote className="browser-daily-quote-compact">“{compactDaily.quote}”</blockquote>
      <figcaption className="browser-daily-quote-compact">— {compactDaily.author}</figcaption>
    </figure>
  );
}
