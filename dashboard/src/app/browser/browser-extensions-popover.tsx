"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, Ellipsis, Globe, PictureInPicture2, Plus, Puzzle, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./browser-extensions-popover.module.css";

export default function BrowserExtensionsPopover() {
  const tabs = useDesktopTabs();
  const ready = Boolean(tabs);
  const extensions = tabs?.extensions ?? [];
  const browser = tabs?.tabs.find(tab => tab.id === tabs.activeId)?.browser;
  const pageReady = browser?.pageReady;
  const adBlock = browser?.adBlock;
  const hls = browser?.hls;
  const vpn = browser?.vpn;
  const googlePipReady = !browser?.private && extensions.some(extension => extension.id === "hkgfoiooedgoejojocmhlaklaeopbecg" && extension.action);
  const [extensionAction, setExtensionAction] = useState<string | null>(null);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      void sendDesktopTabsCommand({ type: "browser-extensions-resize", height: Math.ceil(node.getBoundingClientRect().height) + 2 });
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    if (ready) root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [ready]);

  async function loadBrowserExtension() {
    setExtensionAction("load");
    setExtensionError(null);
    const loaded = await sendDesktopTabsCommand({ type: "browser-extension-load" });
    if (!loaded) setExtensionError("That folder could not be loaded. Check that it contains a valid manifest.json file.");
    setExtensionAction(null);
  }

  async function toggleAdBlock(siteOnly = false) {
    if (!adBlock || (siteOnly && !adBlock.site)) return;
    setExtensionAction("adblock");
    setExtensionError(null);
    try {
      const ok = await sendDesktopTabsCommand(siteOnly
        ? { type: "browser-adblock-site-enabled", enabled: !adBlock.siteEnabled, site: adBlock.site! }
        : { type: "browser-adblock-enabled", enabled: !adBlock.enabled });
      if (!ok) setExtensionError("The ad blocker setting could not be saved. Try again.");
    } catch {
      setExtensionError("The ad blocker did not respond. Try again.");
    } finally { setExtensionAction(null); }
  }

  async function toggleVpn() {
    if (!vpn) return;
    setExtensionAction("vpn");
    setExtensionError(null);
    try {
      if (!await sendDesktopTabsCommand({ type: "browser-vpn-enabled", enabled: !vpn.enabled })) {
        setExtensionError("Cloudflare WARP could not be installed. Try again.");
      }
    } catch {
      setExtensionError("The VPN did not respond. Try again.");
    } finally { setExtensionAction(null); }
  }

  async function reloadBrowserExtension(id: string) {
    setExtensionAction(`reload:${id}`);
    setExtensionError(null);
    const reloaded = await sendDesktopTabsCommand({ type: "browser-extension-reload", id });
    if (!reloaded) setExtensionError("The extension could not be reloaded.");
    setExtensionAction(null);
  }

  async function removeBrowserExtension(id: string) {
    setExtensionAction(`remove:${id}`);
    setExtensionError(null);
    const removed = await sendDesktopTabsCommand({ type: "browser-extension-remove", id });
    if (!removed) setExtensionError("The extension could not be removed.");
    else {
      setOpenOptions(null);
      root.current?.querySelector<HTMLButtonElement>("button[data-manage-extensions]")?.focus();
    }
    setExtensionAction(null);
  }

  async function runExtension(id: string, menuId?: string) {
    setExtensionAction(`run:${id}`);
    setExtensionError(null);
    const ok = await sendDesktopTabsCommand({ type: "browser-extension-action", id, ...(menuId ? { menuId } : {}) });
    if (!ok) setExtensionError("The extension did not respond. Reload it and try again.");
    setExtensionAction(null);
  }

  async function downloadHls(id: string) {
    setExtensionAction(`hls:${id}`);
    setExtensionError(null);
    try {
      if (!await sendDesktopTabsCommand({ type: "browser-hls-download", id })) {
        setExtensionError("This stream is no longer available. Play the video again and reopen Extensions.");
      }
    } catch { setExtensionError("The download could not start. Try again."); }
    finally { setExtensionAction(null); }
  }

  return <main className={`browser-extensions-menu ${styles.popover}`} role="dialog" aria-label="Browser extensions"
    onKeyDown={event => {
      if (event.key === "Escape") void sendDesktopTabsCommand({ type: "browser-extensions-close" });
      if (event.key === "Tab") {
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div ref={root} className={styles.content}>
      <header className={styles.header}><strong>Extensions</strong></header>
      <div className={styles.list}>
        <div className={styles.extension}>
          <div className={styles.row}>
          <button type="button" className={styles.rowAction} aria-label="HLS Downloader"
            aria-expanded={openOptions === "hls"} aria-controls="hls-options"
            onClick={() => setOpenOptions(openOptions === "hls" ? null : "hls")}>
            <span className={`${styles.icon} ${styles.pipIcon}`} aria-hidden="true"><Download size={28} /></span>
            <span className={styles.copy}><strong>HLS Downloader</strong>
              <small>{browser?.private ? "Unavailable in private browsing" : `Built in · ${hls?.streams.length ? `${hls.streams.length} stream${hls.streams.length === 1 ? "" : "s"} found` : "Play a video to detect streams"}`}</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          </div>
          {openOptions === "hls" ? <div id="hls-options" className={styles.options} role="group" aria-label="HLS streams">
            {browser?.private ? <p className={styles.version}>Use a regular browser tab to download HLS video.</p>
              : !hls?.available ? <p className={styles.version}>The native downloader is unavailable. Restart Breadboard after updating.</p>
              : !hls.streams.length ? <p className={styles.version}>Start playing a video on this page. Detected HLS streams will appear here automatically.</p>
              : <>
                <p className={styles.version}>Downloads the best available quality with combined audio and video as TS or MP4. Progress and cancellation are in Downloads.</p>
                {hls.streams.map(stream => <div key={stream.id} className={styles.stream}>
                  <button type="button" className={styles.option} aria-label={`Download ${stream.label}`}
                    disabled={extensionAction !== null || stream.state === "preparing" || stream.state === "downloading"}
                    onClick={() => void downloadHls(stream.id)}>
                    <Download size={15} aria-hidden="true" />
                    <span className={styles.copy}><strong>{stream.label}</strong><small>{stream.host}</small></span>
                  </button>
                  {stream.state === "preparing" || stream.state === "downloading" || stream.state === "completed"
                    ? <p className={styles.version} role="status">{stream.state === "preparing" ? "Reading playlist…" : stream.state === "downloading" ? "Downloading · see Downloads" : "Saved · open from Downloads"}</p> : null}
                  {stream.error ? <p className={styles.error} role="alert">{stream.error}</p> : null}
                </div>)}
              </>}
          </div> : null}
        </div>
        {adBlock ? <div className={styles.extension}>
          <div className={styles.row}>
            <button type="button" className={styles.rowAction} role="switch" aria-label="Ad Blocker"
              aria-checked={adBlock.enabled} disabled={!adBlock.available || extensionAction !== null}
              onClick={() => void toggleAdBlock()}>
              <span className={`${styles.icon} ${styles.shieldIcon}`} aria-hidden="true"><ShieldCheck size={28} /></span>
              <span className={styles.copy}><strong>Ad Blocker</strong>
                <small>{!adBlock.available ? "Unavailable · restart Breadboard" : !adBlock.enabled ? "Built in · Off"
                  : adBlock.site && !adBlock.siteEnabled ? "Paused on this site" : `Built in · On${adBlock.site ? ` · ${adBlock.blocked} blocked` : ""}`}</small>
              </span>
              <span className={styles.toggle} data-enabled={adBlock.enabled && adBlock.available} aria-hidden="true" />
            </button>
            <button type="button" className={styles.more} aria-label="Ad Blocker options"
              aria-expanded={openOptions === "adblock"} aria-controls="adblock-options"
              onClick={() => setOpenOptions(openOptions === "adblock" ? null : "adblock")}>
              <Ellipsis size={18} aria-hidden="true" />
            </button>
          </div>
          {openOptions === "adblock" ? <div id="adblock-options" className={styles.options} role="group" aria-label="Ad Blocker options">
            {adBlock.site ? <button type="button" className={styles.option} role="switch"
              aria-label={`Block ads on ${adBlock.site}`} aria-checked={adBlock.siteEnabled}
              disabled={!adBlock.available || !adBlock.enabled || extensionAction !== null} onClick={() => void toggleAdBlock(true)}>
              <span className={styles.check} aria-hidden="true">{adBlock.siteEnabled ? <Check size={14} /> : null}</span>
              <span className={styles.siteLabel}>Block on {adBlock.site}</span>
            </button> : null}
            <p className={styles.version}>Blocks ads and trackers, hides ad panels, and applies video-site fixes. Reload after changing a setting.</p>
            {browser?.private ? <p className={styles.version}>Changes last for this private session.</p> : null}
          </div> : null}
        </div> : null}
        {vpn ? <div className={styles.extension}>
          <div className={styles.row}>
            <button type="button" className={styles.rowAction} role="switch" aria-label="VPN"
              aria-checked={vpn.enabled} disabled={extensionAction !== null} onClick={() => void toggleVpn()}>
              <span className={`${styles.icon} ${styles.pipIcon}`} aria-hidden="true"><Globe size={28} /></span>
              <span className={styles.copy}><strong>VPN</strong>
                <small>{extensionAction === "vpn" && !vpn.enabled ? "Setting up…" : vpn.status === "on" ? "Built in · On"
                  : vpn.status === "connecting" ? "Connecting…" : vpn.status === "error" ? "Can't connect" : "Built in · Off"}</small>
              </span>
              <span className={styles.toggle} data-enabled={vpn.enabled} aria-hidden="true" />
            </button>
          </div>
        </div> : null}
        {!googlePipReady ? <button type="button" aria-label="Picture in Picture" className={`${styles.rowAction} ${styles.pictureInPicture}`} disabled={!pageReady}
          onClick={() => void sendDesktopTabsCommand({ type: "browser-extensions-picture-in-picture" })}>
          <span className={`${styles.icon} ${styles.pipIcon}`} aria-hidden="true"><PictureInPicture2 size={28} /></span>
          <span className={styles.copy}><strong>Picture in Picture</strong><small>Built in · Alt+P</small></span>
        </button> : null}
        {extensions.length ? extensions.map(extension => (
          <div key={extension.id} className={styles.extension}>
            <div className={styles.row}>
              <button type="button" className={styles.rowAction}
                disabled={!extension.action || !pageReady || browser?.private || extensionAction !== null}
                aria-label={extension.action ? `Run ${extension.name}` : extension.name} title={extension.name}
                onClick={() => void runExtension(extension.id)}>
                <span className={styles.icon} aria-hidden="true">
                  <Puzzle size={28} />
                  {extension.iconUrl ? /* Local extension icons are supplied as data URLs by the desktop shell. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={extension.iconUrl} src={extension.iconUrl} alt="" width={32} height={32}
                      onError={event => { event.currentTarget.hidden = true; }} /> : null}
                </span>
                <span className={styles.copy}>
                  <strong>{extension.name}</strong>
                  <small>{browser?.private ? "Unavailable in private browsing" : extension.action
                    ? (pageReady ? "Open extension" : "Open a page to use this extension")
                    : "No actions available on this page"}</small>
                </span>
              </button>
              <button type="button" className={styles.more}
                aria-label={`More options for ${extension.name}`} title={`More options for ${extension.name}`}
                aria-expanded={openOptions === extension.id} aria-controls={`extension-options-${extension.id}`}
                onClick={() => setOpenOptions(openOptions === extension.id ? null : extension.id)}>
                <Ellipsis size={18} aria-hidden="true" />
              </button>
            </div>
            {openOptions === extension.id ? <div id={`extension-options-${extension.id}`} className={styles.options}
              role="group" aria-label={`Options for ${extension.name}`}>
              <p className={styles.version}>Version {extension.version}</p>
              {extension.action?.menus.map(item => <button type="button" key={item.id} className={styles.option}
                role={item.checked === undefined ? undefined : "checkbox"} aria-checked={item.checked}
                disabled={browser?.private || extensionAction !== null} onClick={() => void runExtension(extension.id, item.id)}>
                <span className={styles.check} aria-hidden="true">{item.checked ? <Check size={14} /> : null}</span>{item.title}
              </button>)}
              <button type="button" className={styles.option} aria-label={`Reload ${extension.name}`}
                disabled={extensionAction !== null} onClick={() => void reloadBrowserExtension(extension.id)}>
                <RotateCw size={15} aria-hidden="true" />{extensionAction === `reload:${extension.id}` ? "Reloading…" : "Reload extension"}
              </button>
              <button type="button" className={`${styles.option} ${styles.remove}`} aria-label={`Remove ${extension.name}`}
                disabled={extensionAction !== null} onClick={() => void removeBrowserExtension(extension.id)}>
                <Trash2 size={15} aria-hidden="true" />{extensionAction === `remove:${extension.id}` ? "Removing…" : "Remove extension"}
              </button>
            </div> : null}
          </div>
        )) : <p className={styles.empty}>No additional extensions loaded.</p>}
      </div>
      {extensionError ? <p className={styles.error} role="alert">{extensionError}</p> : null}
      <footer className={styles.footer}>
        <button type="button" className={styles.manage} data-manage-extensions
          aria-expanded={managing} aria-controls="extension-management" onClick={() => setManaging(!managing)}>
          Manage extensions
        </button>
      </footer>
      {managing ? <div id="extension-management" className={styles.management}>
        <button type="button" aria-label="Load unpacked extension" className={styles.load} disabled={extensionAction !== null} onClick={() => void loadBrowserExtension()}>
          <Plus size={16} aria-hidden="true" />
          {extensionAction === "load" ? "Loading extension…" : "Load unpacked"}
        </button>
        <p className={styles.note}>
          Install from a Chrome Web Store listing with “Add to Breadboard,” or choose an unpacked extension folder. Compatibility varies by extension.
        </p>
      </div> : null}
    </div>
  </main>;
}
