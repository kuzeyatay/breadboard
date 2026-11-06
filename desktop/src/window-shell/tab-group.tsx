import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import TabGroupPopover from "../../../dashboard/src/app/browser/tab-group-popover/tab-group-popover";
import { useDesktopTabs } from "../../../dashboard/src/app/components/use-desktop-tabs";

function GroupMenu() {
  const state = useDesktopTabs();
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? "light";
  }, [state?.theme]);
  return <TabGroupPopover />;
}

createRoot(document.getElementById("root")!).render(<GroupMenu />);
