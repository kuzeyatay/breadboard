"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand, TAB_GROUP_COLORS, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./tab-group-popover.module.css";

type Action = Extract<DesktopTabsCommand, { type: "group-action" }>["action"];

export default function TabGroupPopover() {
  const state = useDesktopTabs();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const group = state?.groups?.find(group => group.id === groupId);
  const members = state?.tabs.filter(tab => tab.groupId === groupId) ?? [];
  const anchored = members.some(tab => tab.anchored);
  const privateGroup = members.some(tab => tab.browser?.private);

  useEffect(() => { setGroupId(new URLSearchParams(window.location.search).get("group")); }, []);
  useEffect(() => { if (group) { setName(group.name); input.current?.focus(); } }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      void sendDesktopTabsCommand({ type: "group-menu-resize", height: node.getBoundingClientRect().height + 2 });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const close = () => { void sendDesktopTabsCommand({ type: "group-menu-close" }); };
  async function act(action: Action, id = groupId) {
    if (!id || busy) return;
    setBusy(true);
    setError("");
    if (group && name !== group.name) await sendDesktopTabsCommand({ type: "group-update", groupId: id, name });
    const ok = await sendDesktopTabsCommand({ type: "group-action", groupId: id, action });
    if (ok && action !== "delete-saved") close();
    else if (!ok) setError("Couldn’t update this group. Please try again.");
    setBusy(false);
  }

  return <Dialog.Root open modal onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Content className={styles.popover} aria-describedby={undefined}
      style={{ "--group-color": TAB_GROUP_COLORS[group?.color ?? "blue"] } as CSSProperties}
      onCloseAutoFocus={event => event.preventDefault()}>
      <div ref={content} className={styles.content}>
        <header><Dialog.Title>{groupId ? "Manage tab group" : "Saved tab groups"}</Dialog.Title>
          <button type="button" aria-label="Close menu" onClick={close}>×</button></header>
        {group ? <>
          <label className={styles.name}>Name
            <input ref={input} value={name} maxLength={80} placeholder="Example: Shopping"
              onChange={event => setName(event.target.value)}
              onBlur={() => { if (name !== group.name) void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, name }); }}
              onKeyDown={event => { if (event.key === "Enter") { void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, name }).then(close); } }} />
          </label>
          <div className={styles.colors} role="group" aria-label="Group color">
            {Object.entries(TAB_GROUP_COLORS).map(([color, hex]) => <button key={color} type="button"
              aria-label={`${color[0].toUpperCase()}${color.slice(1)}`} aria-pressed={group.color === color}
              style={{ background: hex }} onClick={() => { void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, color: color as typeof group.color }); }} />)}
          </div>
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => void act("new-tab")}>New tab in group</button>
            <button disabled={busy} onClick={() => void act("new-window")}>Move group to new window</button>
            <button disabled={busy} onClick={() => void act("copy-links")}>Copy links in group</button>
            <button disabled={busy || anchored || privateGroup} title={anchored ? "Unanchor tabs before closing the group" : privateGroup ? "Private groups cannot be saved" : undefined}
              onClick={() => void act("save-close")}>Save and close group</button>
            <button disabled={busy} onClick={() => void act("ungroup")}>Ungroup tabs</button>
            <hr />
            <button className={styles.danger} disabled={busy || anchored} title={anchored ? "Unanchor tabs before deleting the group" : undefined}
              onClick={() => void act("delete")}>Delete group</button>
          </div>
        </> : groupId && state ? <p>This group is no longer open.</p> : <div className={styles.actions}>
          {state?.savedGroups?.length ? state.savedGroups.map(saved => <div className={styles.saved} key={saved.id}>
            <button disabled={busy} onClick={() => void act("restore", saved.id)}>
              <span style={{ background: TAB_GROUP_COLORS[saved.color] }} />
              <span>{saved.name || "Unnamed group"}<small>{saved.tabCount} tabs · Restore group</small></span>
            </button>
            <button disabled={busy} className={styles.danger} aria-label={`Delete saved ${saved.name || "group"}`} onClick={() => void act("delete-saved", saved.id)}>×</button>
          </div>) : <p>No saved groups.</p>}
        </div>}
        {error ? <p role="alert" className={styles.danger}>{error}</p> : null}
      </div>
    </Dialog.Content>
  </Dialog.Root>;
}
