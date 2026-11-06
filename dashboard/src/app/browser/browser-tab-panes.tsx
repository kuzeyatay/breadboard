"use client";

import type { ReactNode } from "react";
import { DesktopTabIdentityContext } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand, type DesktopTabsState, type DesktopTabView } from "@/lib/desktop-browser-tabs";

/** Keep browser home and panels alive, with one containing block per split pane. */
export default function BrowserTabPanes({ state, children }: {
  state: DesktopTabsState; children: (tab: DesktopTabView) => ReactNode;
}) {
  const outgoing = state.tabs.find(tab => tab.id === state.presentedId);
  // Follow the native surface: ordinary selections move immediately, while a
  // cold Terminal keeps the outgoing website and its rail until it is ready.
  const visibleId = state.visibleId !== undefined ? state.visibleId
    : !state.persistentShell && state.presentationStatus === "pending" && outgoing?.browser ? outgoing.id : state.activeId;
  const group = state.groups?.find(group => group.split && !group.collapsed && state.tabs.find(tab => tab.id === visibleId)?.groupId === group.id);
  const members = group ? state.tabs.filter(tab => tab.groupId === group.id) : [];
  const split = members.length === 2 ? members : [];
  return <>{state.tabs.filter(tab => tab.browser && (tab.browser.uiVisited || tab.id === state.activeId || tab.id === visibleId || split.includes(tab))).map(tab => {
    const pane = split.indexOf(tab);
    const visible = split.length ? pane >= 0 : tab.id === visibleId;
    return <DesktopTabIdentityContext.Provider key={tab.browser?.uiKey ?? tab.id} value={tab.id}>
      <div hidden={!visible} data-browser-content-id={tab.id} data-desktop-tab-active={visible} data-browser-split-pane={pane >= 0 || undefined}
        onPointerDownCapture={() => { if (pane >= 0 && tab.id !== state.activeId) void sendDesktopTabsCommand({ type: "activate", id: tab.id }); }}
        style={pane >= 0 ? { position: "absolute", display: "flex", flexDirection: "column", top: 0, bottom: 0,
          left: pane === 0 ? 0 : "calc(50% + 4px)", width: "calc(50% - 4px)", overflow: "hidden", transform: "translateZ(0)" } : undefined}>
        {children(tab)}
      </div>
    </DesktopTabIdentityContext.Provider>;
  })}</>;
}
