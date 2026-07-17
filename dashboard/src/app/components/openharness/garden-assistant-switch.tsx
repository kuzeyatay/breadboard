"use client";

// Chooses the garden chat backend: the OpenHarness-backed garden agent when the
// runtime is enabled and healthy, otherwise the existing (legacy) GardenAssistant
// so the surface never breaks when OpenHarness is off (acceptance criterion 18).
//
// A floating launcher button opens the runtime chat; the legacy assistant keeps
// its own chrome. This is an additive swap — no behavior is lost when disabled.

import { useEffect, useState } from "react";
import GardenAssistant from "@/app/garden/garden-assistant";
import GardenAgentChat from "./garden-agent-chat";

interface ActiveMarkdown {
  cluster: string;
  slug: string;
  title?: string;
  content?: string;
  loading?: boolean;
}

interface Props {
  activeClusterSlug: string | null;
  activeClusterName?: string;
  activeMarkdown?: ActiveMarkdown | null;
  initialOpen?: boolean;
}

export default function GardenAssistantSwitch(props: Props) {
  const [runtime, setRuntime] = useState<"checking" | "on" | "off">("checking");
  const [open, setOpen] = useState(Boolean(props.initialOpen));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/openharness/health")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setRuntime(data?.enabled && data?.healthy ? "on" : "off");
      })
      .catch(() => {
        if (!cancelled) setRuntime("off");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Until we know, and whenever the runtime is unavailable, use the legacy
  // assistant untouched.
  if (runtime !== "on") {
    return <GardenAssistant {...props} />;
  }

  if (!props.activeClusterSlug) {
    return <GardenAssistant {...props} />;
  }

  return (
    <>
      {open ? (
        <GardenAgentChat
          gardenSlug={props.activeClusterSlug}
          gardenName={props.activeClusterName}
          onClose={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 rounded-full border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-gray-100 shadow-lg hover:bg-gray-800"
        >
          Ask this garden
        </button>
      )}
    </>
  );
}
