"use client";

// Settings → Messaging: the apps that can reach Breadboard from a phone.
//
// One tab, one question — "which messaging apps talk to my agent" — with a
// service picker rather than two stacked panels, because each service's own
// controls are long enough that stacking them would bury the second one.
// The picker carries each service's live state as a dot, so the tab still
// answers "is anything connected?" at a glance without being opened.

import { useState } from "react";

import SettingsTelegram, { PaperPlaneIcon, useTelegramStatus } from "./settings-telegram";
import SettingsWhatsApp, { MessageBubbleIcon, useWhatsAppStatus } from "./settings-whatsapp";

type Service = "whatsapp" | "telegram";

type Health = "connected" | "attention" | "idle";

function dotClass(health: Health): string {
  return health === "connected"
    ? "bg-[#4F805E]"
    : health === "attention"
      ? "bg-[var(--danger)]"
      : "bg-[var(--line-strong)]";
}

export default function SettingsMessaging() {
  const [service, setService] = useState<Service>("whatsapp");

  // Both services poll: the visible one quickly, the other slowly, so its dot is
  // honest the moment you switch to it.
  const whatsApp = useWhatsAppStatus(service === "whatsapp");
  const telegram = useTelegramStatus(service === "telegram");

  const health = (state: string | undefined): Health =>
    state === "connected" ? "connected" : state === "error" ? "attention" : "idle";

  const services: Array<{ value: Service; label: string; health: Health; icon: typeof MessageBubbleIcon }> = [
    {
      value: "whatsapp",
      label: "WhatsApp",
      health: health(whatsApp.status?.state),
      icon: MessageBubbleIcon,
    },
    {
      value: "telegram",
      label: "Telegram",
      health: health(telegram.status?.state),
      icon: PaperPlaneIcon,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="neu-segmented inline-flex rounded-xl p-1" role="tablist" aria-label="Messaging services">
        {services.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={service === item.value}
              onClick={() => setService(item.value)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                service === item.value
                  ? "text-[var(--ink-heading)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClass(item.health)}`} />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[var(--ink-muted)]">
        Messages sent to a linked app open a real Breadboard chat — same memory, same
        capabilities — that you can reopen and continue by hand in the Terminal.
      </p>

      {service === "whatsapp" ? (
        <SettingsWhatsApp status={whatsApp.status} refresh={whatsApp.refresh} />
      ) : (
        <SettingsTelegram status={telegram.status} refresh={telegram.refresh} />
      )}
    </div>
  );
}
