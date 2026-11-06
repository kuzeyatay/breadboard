"use client";

import { useState } from "react";
import NotificationCenter, { type NotificationCenterProps } from "./notification-center";
import { Toaster, type ToastItem } from "./toast";

/** Opening the inbox must not rerender the gardens, dock, or terminal. */
export default function DashboardNotifications({ enabled, toasts, onDismissToast, ...center }: Omit<NotificationCenterProps, "open" | "onOpenChange"> & {
  enabled: boolean;
  toasts: ToastItem[];
  onDismissToast: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    {enabled && <NotificationCenter {...center} open={open} onOpenChange={setOpen} />}
    <Toaster toasts={enabled && open ? [] : toasts} onDismiss={onDismissToast} onOpenChat={center.onOpenChat} />
  </>;
}
