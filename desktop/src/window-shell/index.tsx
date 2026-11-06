import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import DesktopTitleBar from "../../../dashboard/src/app/components/desktop-title-bar";
import { useDesktopTabs } from "../../../dashboard/src/app/components/use-desktop-tabs";
import BrowserNavigation from "../../../dashboard/src/app/browser/browser-navigation";
import { sendDesktopTabsCommand } from "../../../dashboard/src/lib/desktop-browser-tabs";
import NavigationProgressBar from "../../../dashboard/src/app/components/navigation-progress-bar";
import "./window-shell.css";


function WindowShell() {
  const state = useDesktopTabs();
  const active = state?.tabs.find(tab => tab.id === state.activeId);
  const toolbar = state?.tabs.find(tab => tab.id === state.selfId && tab.browser);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? "light";
  }, [state?.theme]);
  useLayoutEffect(() => {
    // This native view grows to fit the suggestions, so its own 100vh is not
    // the available space. Keep dropdown sizing tied to the full window.
    const style = document.documentElement.style;
    if (state?.contentHeight !== undefined) {
      style.setProperty("--breadboard-window-height", `${state.contentHeight}px`);
    } else {
      style.removeProperty("--breadboard-window-height");
    }
  }, [state?.contentHeight]);
  return <>
    <DesktopTitleBar shell />
    {toolbar && <BrowserNavigation key={toolbar.id} showFlowers
      restoreOwnerKey={state?.browserOwnerKey ?? ""} onPanel={() => {}} />}
    <NavigationProgressBar trackedNavigationPending={state?.presentationStatus === "pending" || active?.loading === true || active?.pageLoading === true} />
    {state?.presentationStatus === "failed" && <div className="shell-error" role="alert">This page stopped responding. <button onClick={() => void sendDesktopTabsCommand({type:"reload"})}>Reload</button></div>}
  </>;
}
createRoot(document.getElementById("root")!).render(<WindowShell />);
