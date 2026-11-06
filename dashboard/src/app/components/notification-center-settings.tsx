"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { sendDesktopTabsCommand, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { getNotificationSoundEnabled, setNotificationSoundEnabled, subscribeNotificationSound } from "@/lib/notification-sound";
import { useDesktopTabs } from "./use-desktop-tabs";
import appearanceStyles from "./page-appearance.module.css";
import styles from "./notification-center.module.css";
import panelStyles from "./utility-panel.module.css";

function NotificationSwitch({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
    className={`${appearanceStyles.randomSwitch} ${styles.switch}`} onClick={() => onChange(!checked)}><span /></button>;
}

function siteName(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

export default function NotificationCenterSettings() {
  const tabs = useDesktopTabs();
  const preferences = tabs?.browserPreferences;
  const soundEnabled = useSyncExternalStore(subscribeNotificationSound, getNotificationSoundEnabled, () => true);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(command: DesktopTabsCommand) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!await sendDesktopTabsCommand(command)) throw new Error("Permission update failed");
    } catch { setError("Couldn’t save. Try again."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <div className={styles.settings}>
    <div className={styles.settingsGroup}>
      <div className={styles.settingRow}>
        <span>Notification sound</span>
        <NotificationSwitch label="Notification sound" checked={soundEnabled} onChange={enabled => {
          setError(setNotificationSoundEnabled(enabled) ? "" : "Couldn’t save. Try again.");
        }} />
      </div>
      <div className={styles.settingRow}>
        <span>Website notifications</span>
        <NotificationSwitch label="Website notifications" checked={preferences?.notificationsEnabled ?? false} disabled={busy || !preferences}
          onChange={enabled => void save({ type: "browser-notifications-enabled", enabled })} />
      </div>
    </div>
    <h2 className={styles.settingsLabel}>Websites</h2>
    {preferences ? Object.keys(preferences.sites).length ? <div className={styles.settingsGroup}>
      {Object.entries(preferences.sites).sort(([left], [right]) => left.localeCompare(right)).map(([origin, permission]) => <div key={origin} className={styles.settingRow}>
        <span className={styles.siteName} title={origin}>{siteName(origin)}</span>
        <div className={styles.actions}>
          <button type="button" className={panelStyles.iconButton} disabled={busy} aria-label={`Ask again for ${origin}`} title="Ask again"
            onClick={() => void save({ type: "browser-notification-permission", origin, permission: "default" })}>
            <RotateCcw size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <NotificationSwitch label={`Notifications for ${origin}`} checked={permission === "granted"} disabled={busy}
            onChange={enabled => void save({ type: "browser-notification-permission", origin, permission: enabled ? "granted" : "denied" })} />
        </div>
      </div>)}
    </div> : <p className={styles.settingsHint}>No websites yet.</p>
      : <p className={styles.settingsHint}>Website permissions are available in Breadboard desktop.</p>}
    {error && <p className={styles.settingsError} role="alert">{error}</p>}
  </div>;
}
