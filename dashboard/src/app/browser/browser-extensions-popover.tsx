"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Ellipsis, PictureInPicture2, Plus, Puzzle, RotateCw, Trash2 } from "lucide-react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./browser-extensions-popover.module.css";

export default function BrowserExtensionsPopover() {
  const tabs = useDesktopTabs();
  const ready = Boolean(tabs);
  const extensions = tabs?.extensions ?? [];
  const browser = tabs?.tabs.find(tab => tab.id === tabs.activeId)?.browser;
  const pageReady = browser?.pageReady;
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
        {!googlePipReady ? <button type="button" className={`${styles.rowAction} ${styles.pictureInPicture}`} disabled={!pageReady}
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
        )) : <p className={styles.empty}>No extensions loaded yet.</p>}
      </div>
      {extensionError ? <p className={styles.error} role="alert">{extensionError}</p> : null}
      <footer className={styles.footer}>
        <button type="button" className={styles.manage} data-manage-extensions
          aria-expanded={managing} aria-controls="extension-management" onClick={() => setManaging(!managing)}>
          Manage extensions
        </button>
      </footer>
      {managing ? <div id="extension-management" className={styles.management}>
        <button type="button" className={styles.load} disabled={extensionAction !== null} onClick={() => void loadBrowserExtension()}>
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
