"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { AI_TAB_GROUP_ID, sendDesktopTabsCommand, TAB_GROUP_COLORS, type DesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./tab-group-popover.module.css";
import { isInTabGroup, tabGroupPath } from "@/lib/desktop-tab-groups";

type Action = Extract<DesktopTabsCommand, { type: "group-action" }>["action"];

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function locationGroupId() { return new URLSearchParams(window.location.search).get("group"); }
function serverGroupId() { return null; }

export default function TabGroupPopover() {
  const state = useDesktopTabs();
  const groupId = useSyncExternalStore(subscribeLocation, locationGroupId, serverGroupId);
  const [nameDraft, setNameDraft] = useState<{ groupId: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const group = state?.groups?.find(group => group.id === groupId);
  const aiGroup = group?.id === AI_TAB_GROUP_ID;
  const name = nameDraft && nameDraft.groupId === group?.id ? nameDraft.name : group?.name ?? "";
  const groups = state?.groups ?? [];
  const members = state?.tabs.filter(tab => groupId && isInTabGroup(groups, tab.groupId, groupId)) ?? [];
  const anchored = members.some(tab => tab.anchored);
  const privateGroup = members.some(tab => tab.browser?.private);
  const parents = groups.filter(candidate => candidate.id !== group?.parentId && groupId && !isInTabGroup(groups, candidate.id, groupId) &&
    Boolean(state?.tabs.find(tab => isInTabGroup(groups, tab.groupId, candidate.id))?.browser?.private) === privateGroup);

  useEffect(() => { input.current?.focus(); }, [group?.id]);
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

  async function moveInto(parentId: string | null) {
    if (!group || !state || busy) return;
    setBusy(true);
    setError("");
    if (name !== group.name) await sendDesktopTabsCommand({ type: "group-update", groupId: group.id, name });
    const rest = state.tabs.filter(tab => !isInTabGroup(groups, tab.groupId, group.id));
    const index = parentId ? rest.findLastIndex(tab => isInTabGroup(groups, tab.groupId, parentId)) + 1 : rest.length;
    const ok = await sendDesktopTabsCommand({ type: "group-move", groupId: group.id, parentId, index });
    if (ok) close();
    else setError("Couldn’t move this group. Please try again.");
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
            <input ref={input} value={name} readOnly={aiGroup} maxLength={80} placeholder="Example: Shopping"
              onChange={event => setNameDraft({ groupId: group.id, name: event.target.value })}
              onBlur={() => { if (name !== group.name) void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, name }); }}
              onKeyDown={event => { if (event.key === "Enter") { if (aiGroup) close(); else void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, name }).then(close); } }} />
          </label>
          {aiGroup ? <p>Pages opened by Breadboard appear here.</p> : <div className={styles.colors} role="group" aria-label="Group color">
            {Object.entries(TAB_GROUP_COLORS).map(([color, hex]) => <button key={color} type="button"
              aria-label={`${color[0].toUpperCase()}${color.slice(1)}`} aria-pressed={group.color === color}
              style={{ background: hex }} onClick={() => { void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, color: color as typeof group.color }); }} />)}
          </div>}
          <div className={styles.actions}>
            {!aiGroup && state?.persistentShell && !groups.some(child => child.parentId === group.id) && members.length === 2 ? <button disabled={busy} onClick={() => { void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, split: !group.split }).then(ok => { if (ok) close(); }); }}>{group.split ? "Leave split view" : "Show side by side"}</button> : null}
            <button disabled={busy} onClick={() => void act("new-tab")}>New tab in group</button>
            <button disabled={busy} onClick={() => void act("new-subgroup")}>New subgroup</button>
            {!aiGroup && parents.length ? <label className={styles.parent}>Move into group
              <select value="" disabled={busy} onChange={event => { if (event.target.value) void moveInto(event.target.value); }}>
                <option value="" disabled>Choose a group…</option>
                {parents.map(parent => <option key={parent.id} value={parent.id}>{tabGroupPath(groups, parent.id).map(group => group.name || "Unnamed group").join(" / ")}</option>)}
              </select>
            </label> : null}
            {group.parentId ? <button disabled={busy} onClick={() => void moveInto(groups.find(parent => parent.id === group.parentId)?.parentId ?? null)}>Move out of parent group</button> : null}
            {!aiGroup ? <button disabled={busy} onClick={() => void act("new-window")}>Move group to new window</button> : null}
            <button disabled={busy || !members.length} onClick={() => void act("copy-links")}>Copy links in group</button>
            <button disabled={busy || !members.length} title="Unload tabs to free memory. Each tab reloads when selected."
              onClick={() => void act("neutralize")}>Neutralize tab group</button>
            {!aiGroup ? <button disabled={busy || anchored || privateGroup} title={anchored ? "Unanchor tabs before closing the group" : privateGroup ? "Private groups cannot be saved" : undefined}
              onClick={() => void act("save-close")}>Save and close group</button> : null}
            {!aiGroup ? <button disabled={busy} onClick={() => void act("ungroup")}>Ungroup tabs</button> : null}
            <hr />
            <button className={styles.danger} disabled={busy || anchored || !members.length} title={anchored ? "Unanchor tabs before deleting the group" : undefined}
              onClick={() => void act("delete")}>{aiGroup ? "Close tabs in group" : "Delete group"}</button>
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
