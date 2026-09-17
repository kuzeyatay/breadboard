export type NotificationChannel = "whatsapp" | "telegram";

export interface MessagingNotificationSettings {
  enabled: boolean;
  recipient: string;
  recipients: Array<{ id: string; label: string }>;
  available: boolean;
  lastError: string | null;
  lastSentAt: string | null;
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return value === "whatsapp" || value === "telegram";
}
