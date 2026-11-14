import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import BrowserDownloadsPopover from "../../../dashboard/src/app/browser/browser-downloads-popover";
import { useDesktopTabs } from "../../../dashboard/src/app/components/use-desktop-tabs";

function Downloads() {
  const state = useDesktopTabs();
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? "light";
    document.documentElement.style.setProperty("--downloads-popover-height", `${Math.max(1, Math.min(480, (state?.contentHeight ?? 496) - 16))}px`);
  }, [state?.theme, state?.contentHeight]);
  return <BrowserDownloadsPopover />;
}

createRoot(document.getElementById("root")!).render(<Downloads />);
