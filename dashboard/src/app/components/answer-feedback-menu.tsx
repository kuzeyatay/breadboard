"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  fetchAnswerRating, saveAnswerRating,
  type AnswerRating, type AnswerSignalReason, type SignalTarget,
} from "@/lib/hermes/answer-signal-client";

const reasons: Record<AnswerSignalReason, string> = {
  wrong: "Incorrect information",
  too_long: "Too long",
  missed_point: "Missed my question",
  style: "Unhelpful style",
};

export function localFeedbackKey(content: string): string {
  // Preserve ratings from readers that have no stored conversation.
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `breadboard:assistant-feedback:${(hash >>> 0).toString(36)}`;
}

export default function AnswerFeedbackMenu({ target, localKey, className }: {
  target: SignalTarget;
  localKey?: string;
  className: string;
}) {
  const [rating, setRating] = useState<AnswerRating | null>(null);
  const [open, setOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const edited = useRef(false);
  const firstReason = useRef<HTMLDivElement>(null);
  const statusId = useId();

  useEffect(() => {
    if (localKey) {
      try {
        const saved = localStorage.getItem(localKey);
        setRating(saved === "up" ? "rated_up" : saved === "down" ? "rated_down" : null);
      } catch { /* The user can still open the menu with storage disabled. */ }
      return;
    }
    let active = true;
    void fetchAnswerRating(target).then(saved => {
      if (active && !edited.current) setRating(saved);
    });
    return () => { active = false; };
  }, [target, localKey]);

  useEffect(() => {
    if (open && showReasons) firstReason.current?.focus();
  }, [open, showReasons]);

  async function save(next: AnswerRating | null, reason?: AnswerSignalReason) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (localKey) {
        if (next) localStorage.setItem(localKey, next === "rated_up" ? "up" : "down");
        else localStorage.removeItem(localKey);
      } else {
        await saveAnswerRating(target, next, reason);
      }
      edited.current = true;
      setRating(next);
      if (next === "rated_down" && !reason && !localKey) setShowReasons(true);
      else setOpen(false);
    } catch {
      setError("Couldn’t save feedback. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const label = rating === "rated_up" ? "Good response" : rating === "rated_down" ? "Bad response" : "";
  return (
    <Menu.Root modal={false} open={open} onOpenChange={next => {
      if (next) { setShowReasons(false); setError(""); }
      setOpen(next);
    }}>
      <Menu.Trigger asChild>
        <button type="button" className={`${className} bb-answer-feedback-trigger`}
          title={label ? `${label} · Change feedback` : "Response feedback"}
          aria-label="Response feedback" aria-describedby={label ? statusId : undefined} data-rated={Boolean(rating)}>
          {rating === "rated_up" ? <ThumbsUp size={16} aria-hidden /> :
            rating === "rated_down" ? <ThumbsDown size={16} aria-hidden /> :
            <span className="relative block h-5 w-5" aria-hidden>
              <ThumbsUp size={13} strokeWidth={1.8} className="absolute left-0 top-0" />
              <ThumbsDown size={11} strokeWidth={1.8} className="absolute bottom-0 right-0" />
            </span>}
        </button>
      </Menu.Trigger>
      <span id={statusId} className="sr-only" role="status">{label}</span>
      <Menu.Portal>
        <Menu.Content side="bottom" align="start" sideOffset={5} collisionPadding={8} hideWhenDetached
          className="bb-answer-feedback-menu" data-assistant-response-overlay aria-label="Response feedback" aria-busy={saving}>
          {showReasons ? <>
            <Menu.Label className="px-3 pb-1 pt-2 text-xs text-[var(--ink-muted)]">What went wrong?</Menu.Label>
            {(Object.entries(reasons) as [AnswerSignalReason, string][]).map(([reason, text], index) => (
              <Menu.Item key={reason} ref={index === 0 ? firstReason : undefined} className="bb-answer-feedback-item"
                disabled={saving} onSelect={event => { event.preventDefault(); void save("rated_down", reason); }}>
                {text}
              </Menu.Item>
            ))}
            <Menu.Item className="bb-answer-feedback-item" onSelect={() => setOpen(false)}>Skip</Menu.Item>
          </> : (["rated_up", "rated_down"] as const).map(value => {
            const Icon = value === "rated_up" ? ThumbsUp : ThumbsDown;
            return (
              <Menu.CheckboxItem key={value} checked={rating === value} disabled={saving} className="bb-answer-feedback-item"
                title={rating === value ? "Remove this rating" : localKey ? "Save this rating on this device" :
                  value === "rated_up" ? "Keep this approach for follow-ups" : "Flag this answer and optionally say why"}
                onSelect={event => { event.preventDefault(); void save(rating === value ? null : value); }}>
                <Icon size={17} strokeWidth={1.7} aria-hidden />
                {value === "rated_up" ? "Good response" : "Bad response"}
                <Menu.ItemIndicator className="ml-auto"><Check size={13} aria-hidden /></Menu.ItemIndicator>
              </Menu.CheckboxItem>
            );
          })}
          {error && <p role="alert" className="px-3 py-2 text-xs">{error}</p>}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
