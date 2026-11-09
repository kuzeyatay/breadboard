import { Notification } from 'electron';
import type { DesktopChatNotification } from '../shared/ipc-contract';

/** Same readable-area threshold as chat-notification-visibility in the renderer. */
export function isChatNotificationCardVisible(rect: DesktopChatNotification['rect'], regions: NonNullable<DesktopChatNotification['rect']>[] | undefined): boolean {
  if (!rect) return false;
  if (regions === undefined) return true;
  return regions.some(region => {
    const width = Math.min(rect.x + rect.width, region.x + region.width) - Math.max(rect.x, region.x);
    const height = Math.min(rect.y + rect.height, region.y + region.height) - Math.max(rect.y, region.y);
    return width >= Math.min(24, rect.width) && height >= Math.min(16, rect.height);
  });
}

interface Source {
  cards: DesktopChatNotification[];
  enabled: () => boolean;
  visible: (card: DesktopChatNotification) => boolean;
  open: (card: DesktopChatNotification) => void;
  delivered: (ids: string[]) => void;
  reported?: Set<string>;
}

/** One OS alert for a chat message whose in-app cards cannot be seen. */
export class ChatNotificationDelivery {
  private sources = new Map<number, Source>();
  private receipts = new Set<string>();
  private osReceipts = new Set<string>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private alerts = new Map<string, Notification>();
  private failed = new Set<string>();

  constructor(private readonly log: (line: string) => void = () => {}) {}

  update(id: number, source: Source): void {
    const previous = this.sources.get(id);
    source.reported = previous?.reported ?? new Set();
    this.sources.set(id, source);
    const live = new Set(source.cards.map(card => card.id));
    for (const card of previous?.cards ?? []) {
      if (live.has(card.id)) continue;
      // A trusted overlay removed the notice after dismissal, reading or reply.
      // Do not wait for another host's slower inbox poll to withdraw the alert.
      this.remember(card.id);
      this.withdraw(card.id);
    }
    this.refresh();
  }

  remove(id: number): void {
    this.sources.delete(id);
    this.refresh();
    if (!this.sources.size) { this.receipts.clear(); this.osReceipts.clear(); this.failed.clear(); }
  }

  refresh(): void {
    const current = this.current();
    for (const id of new Set([...this.pending.keys(), ...this.alerts.keys()])) {
      if (!current.has(id)) this.withdraw(id);
    }
    for (const [id, entries] of current) {
      const visible = entries.some(({ source, card }) => source.visible(card));
      if (visible || entries.some(({ card }) => card.delivered)) this.remember(id);
      if (visible) this.withdraw(id);
      if (this.receipts.has(id)) {
        this.cancelPending(id);
        for (const { source } of entries) {
          if (!this.osReceipts.has(id) || source.reported!.has(id)) continue;
          source.reported!.add(id);
          if (source.reported!.size > 512) source.reported!.delete(source.reported!.values().next().value!);
          source.delivered([id]);
        }
      } else if (!this.pending.has(id) && !this.alerts.has(id) && !this.failed.has(id)) {
        // Native regions and renderer presence arrive independently. Allow the
        // new card's first paint and cross-window read receipts to settle.
        const timer = setTimeout(() => { this.pending.delete(id); this.show(id); }, 350);
        timer.unref();
        this.pending.set(id, timer);
      }
    }
  }

  private current(): Map<string, Array<{ source: Source; card: DesktopChatNotification }>> {
    const current = new Map<string, Array<{ source: Source; card: DesktopChatNotification }>>();
    for (const source of this.sources.values()) {
      if (!source.enabled()) continue;
      for (const card of source.cards) {
        const entries = current.get(card.id) ?? [];
        entries.push({ source, card });
        current.set(card.id, entries);
      }
    }
    return current;
  }

  private show(id: string): void {
    const entries = this.current().get(id);
    if (!entries?.length || this.receipts.has(id)) return;
    if (entries.some(({ source, card }) => card.delivered || source.visible(card))) { this.refresh(); return; }
    if (!Notification.isSupported()) { this.fail(id, 'OS notifications are not supported here'); return; }
    const { card } = entries[0]!;
    try {
      // Always silent: the overlay plays the app's own chime on the delivery
      // receipt, so sound follows Breadboard's toggle and does not depend on
      // Windows' per-app sound setting or a Do-not-disturb banner.
      const alert = new Notification({ title: card.title, body: card.body, silent: true });
      this.alerts.set(id, alert);
      alert.once('show', () => {
        if (this.alerts.get(id) !== alert) { alert.close(); return; }
        const live = this.current().get(id);
        if (!live?.length || live.some(entry => entry.source.visible(entry.card))) {
          this.withdraw(id); return;
        }
        this.osReceipts.add(id);
        if (this.osReceipts.size > 512) this.osReceipts.delete(this.osReceipts.values().next().value!);
        this.remember(id);
        this.refresh();
      });
      alert.once('click', () => {
        const destination = this.current().get(id)?.[0];
        this.withdraw(id);
        destination?.source.open(destination.card);
      });
      alert.once('failed', (_event, error) => {
        this.fail(id, error);
      });
      // Keep the reference after timeout so reading/dismissing the chat also
      // removes the retained entry from Windows Notification Center.
      alert.show();
    } catch (error) { this.fail(id, error instanceof Error ? error.message : String(error)); }
  }

  private fail(id: string, reason: string): void {
    this.log(`OS notification for ${id} failed: ${reason}`);
    this.failed.add(id);
    if (this.failed.size > 512) this.failed.delete(this.failed.values().next().value!);
    this.withdraw(id);
  }

  private remember(id: string): void {
    this.receipts.add(id);
    if (this.receipts.size > 512) this.receipts.delete(this.receipts.values().next().value!);
  }

  private cancelPending(id: string): void {
    clearTimeout(this.pending.get(id)); this.pending.delete(id);
  }

  private withdraw(id: string): void {
    this.cancelPending(id);
    const alert = this.alerts.get(id);
    this.alerts.delete(id);
    try { alert?.close(); } catch { /* The OS may already have retired it. */ }
  }
}
