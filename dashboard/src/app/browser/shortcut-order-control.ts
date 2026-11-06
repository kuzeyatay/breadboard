"use client";

import { validShortcutOrder } from "@/lib/shortcut-order";

/** Keep the order in the account database so a desktop port change cannot reset it. */
export function shortcutOrderControl(ownerKey: string) {
  const endpoint = `/api/profile/shortcut-order?${new URLSearchParams({ownerKey})}`;
  return {
    async read(): Promise<string[]> {
      const response = await fetch(endpoint, {cache:"no-store",signal:AbortSignal.timeout(5000)});
      const data = await response.json();
      if (!response.ok || !validShortcutOrder(data.order)) throw new Error("Couldn’t load the shortcut order.");
      return data.order;
    },
    async write(order: string[]): Promise<boolean> {
      const response = await fetch(endpoint, {method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({order}),signal:AbortSignal.timeout(5000)});
      const data = await response.json();
      return response.ok && validShortcutOrder(data.order);
    },
  };
}
