"use client";

import { useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

export default function BrowserExtensionsButton({ open, count, onOpen }: { open: boolean; count: number; onOpen?: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(false);

  async function toggle() {
    setError(false);
    if (open) {
      await sendDesktopTabsCommand({ type: "browser-extensions-close" });
      return;
    }
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    onOpen?.();
    await sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
    const ok = await sendDesktopTabsCommand({ type: "browser-extensions-popover", x: bounds.right, y: bounds.bottom + 8 });
    if (!ok) setError(true);
  }

  return <div className="browser-extensions-control">
    <button ref={button} type="button" className="browser-extensions-toggle"
      aria-label="Extensions"
      aria-expanded={open} aria-haspopup="dialog" title={error ? "Couldn't open extensions. Try again" : `Extensions (${count} installed)`}
      onClick={() => void toggle()}>
      <Puzzle size={20} aria-hidden="true" />
    </button>
    {error ? <span className="browser-extensions-open-error" role="alert">Couldn’t open extensions. <button type="button" onClick={() => void toggle()}>Try again</button></span> : null}
  </div>;
}
