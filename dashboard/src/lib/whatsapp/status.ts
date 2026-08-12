// The single status payload every WhatsApp route and the Terminal panel read.
//
// The pairing QR is rendered to a PNG data URL on the server. The raw payload is
// a live linked-device credential — handing it to the browser as text would let
// anything that can read the DOM link its own device, so only the picture leaves
// the server.

import QRCode from "qrcode";

import { getWhatsAppBridge, type WhatsAppBridgeState } from "./bridge.ts";
import { whatsAppFeatureEnabled } from "./config.ts";
import { getWhatsAppStore } from "./instance.ts";
import type { WhatsAppMode } from "./identity.ts";
import type { WhatsAppChatRow } from "./store.ts";

export interface WhatsAppChatSummary {
  chatId: string;
  label: string;
  number: string;
  isGroup: boolean;
  messageCount: number;
  lastMessageAt: string;
}

export interface WhatsAppStatus {
  /** The integration is compiled in and the Hermes bridge exists on disk. */
  available: boolean;
  unavailableReason: string | null;
  state: WhatsAppBridgeState;
  error: string | null;
  paired: boolean;
  mode: WhatsAppMode;
  allowedNumbers: string[];
  autostart: boolean;
  linkedNumber: string | null;
  linkedName: string | null;
  linkedAt: string | null;
  /** True when another Breadboard account owns the linked device. */
  managedByAnotherUser: boolean;
  dependenciesInstalled: boolean;
  qrImage: string | null;
  qrAt: string | null;
  log: string[];
  chats: WhatsAppChatSummary[];
}

function presentChat(row: WhatsAppChatRow): WhatsAppChatSummary {
  return {
    chatId: row.chat_id,
    label: row.contact_label || row.contact_number || "WhatsApp",
    number: row.contact_number,
    isGroup: row.is_group === 1,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
  };
}

export async function whatsAppStatus(userId: number): Promise<WhatsAppStatus> {
  const store = getWhatsAppStore();
  const settings = store.settings();
  const bridge = getWhatsAppBridge();
  const snapshot = bridge.snapshot();
  const owned = settings.ownerUserId === null || settings.ownerUserId === userId;

  const qrImage =
    owned && snapshot.qr
      ? await QRCode.toDataURL(snapshot.qr, {
          margin: 1,
          width: 320,
          errorCorrectionLevel: "L",
        }).catch(() => null)
      : null;

  return {
    available: whatsAppFeatureEnabled() && snapshot.bridgeAvailable,
    unavailableReason: !whatsAppFeatureEnabled()
      ? "WhatsApp is switched off for this installation."
      : !snapshot.bridgeAvailable
        ? "The Hermes WhatsApp bridge is not installed with this build."
        : null,
    state: snapshot.state,
    error: snapshot.error,
    paired: snapshot.paired,
    mode: settings.mode,
    allowedNumbers: settings.allowedNumbers,
    autostart: settings.autostart,
    linkedNumber: settings.linkedNumber ?? snapshot.linkedNumber,
    linkedName: settings.linkedName ?? snapshot.linkedName,
    linkedAt: settings.linkedAt,
    managedByAnotherUser: !owned,
    dependenciesInstalled: snapshot.bridgeInstalled,
    qrImage,
    qrAt: snapshot.qrAt,
    log: owned ? snapshot.log : [],
    chats: owned ? store.listChats(userId).map(presentChat) : [],
  };
}
