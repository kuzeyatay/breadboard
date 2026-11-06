import path from "node:path";
import { FlowAdapter, FlowStore, BrowserManager, installBreadboardFlowBrowser, requestBreadboardFlowTab } from "./google-flow-browser.mjs";

const directory = process.argv[2];
if (process.argv.length !== 3 || !directory || !path.isAbsolute(directory)) throw new Error("A Breadboard account directory is required.");
installBreadboardFlowBrowser(directory);
const store = new FlowStore(directory);
const browsers = new BrowserManager(store);
try {
  const target = await requestBreadboardFlowTab(directory);
  const flow = new FlowAdapter(store, browsers, null);
  await flow.connectAccount("breadboard", "Breadboard browser", {
    browserMode: "attach_cdp", cdpUrl: `http://127.0.0.1:${target.cdpPort}`,
    waitForAccountSelectionSeconds: 30,
  });
  console.log(JSON.stringify({ connected: true }));
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "flow_connection_failed";
  console.log(JSON.stringify({ connected: false, code, error: code === "login_required"
    ? "Sign in to Google in Breadboard's browser, then click Connect again. Veo runs in a hidden tab."
    : code === "flow_access_unavailable" ? "Your Google account does not expose the Flow generation workspace."
    : "Could not connect the hidden Flow tab. Restart Breadboard with the updated build, then retry." }));
  process.exitCode = 1;
} finally {
  await browsers.closeAll();
  // Exiting disconnects CDP without closing the shell-owned page or browser.
  process.exit(process.exitCode ?? 0);
}
