"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Download, FolderOpen, PanelRightClose, PanelRightOpen, RotateCcw } from "lucide-react";
import DashboardAgentTerminal from "@/app/components/hermes/dashboard-agent-terminal";
import { desktopCodeBridge, type CodeDockAction, type CodeDockState } from "@/lib/desktop-code";
import NavBar from "@/app/components/navbar";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { desktopTabsBridge } from "@/lib/desktop-browser-tabs";
import { usePageLoading } from "@/app/components/use-page-loading";
import styles from "./code.module.css";

export default function CodeClient(navbar: Partial<ComponentProps<typeof NavBar>> = {}) {
  const [state, setState] = useState<CodeDockState>({ phase: "checking" });
  const [available, setAvailable] = useState(true);
  const tabs = useDesktopTabs();
  const navbarRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [breadOpen, setBreadOpen] = useState(() => { try { return localStorage.getItem("breadboard:code-bread") !== "closed"; } catch { return true; } });
  const toggleBread = () => setBreadOpen(open => { try { localStorage.setItem("breadboard:code-bread", open ? "closed" : "open"); } catch { /* per-viewer convenience only */ } return !open; });
  const active = tabs ? tabs.selfId === tabs.activeId || tabs.visibleIds?.includes(tabs.selfId ?? -1) : !desktopTabsBridge();
  useEffect(() => {
    const element = navbarRef.current, bridge = desktopCodeBridge();
    if (!element || !bridge || !active) return;
    let previous = "";
    const measure = () => {
      const top = Math.min(512, Math.max(0, element.getBoundingClientRect().bottom));
      const right = Math.min(4096, Math.max(0, railRef.current?.getBoundingClientRect().width ?? 0));
      if (`${top},${right}` === previous) return;
      previous = `${top},${right}`;
      void bridge.codeDock({ type: "layout", top, right }).catch(() => undefined);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); if (railRef.current) observer.observe(railRef.current);
    window.addEventListener("resize", measure); measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [active, breadOpen]);
  useEffect(() => {
    if (!active) return;
    const bridge = desktopCodeBridge();
    if (!bridge) { setAvailable(false); setState({ phase: "unsupported" }); return; }
    let disposed = false, reading = false;
    const fail = (error: unknown) => { if (!disposed) setState({ phase: "error", error: String(error) }); };
    void bridge.codeDock("status").then(async initial => {
      if (disposed) return;
      setState(initial);
      if (initial.phase === "ready") {
        const opened = await bridge.codeDock("open");
        if (!disposed) setState(opened);
      }
    }).catch(fail);
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void bridge.codeDock("status").then(next => { if (!disposed) setState(next); }).catch(fail).finally(() => { reading = false; });
    }, 750);
    return () => { disposed = true; clearInterval(timer); };
  }, [active]);
  async function act(action: CodeDockAction) {
    try { const next = await desktopCodeBridge()?.codeDock(action); if (next) setState(next); }
    catch (error) { setState(current => ({ ...current, phase: "error", error: String(error) })); }
  }
  const busy = ["checking", "opening", "downloading", "extracting"].includes(state.phase);
  // VS Code stays hidden until docked; the shared top bar covers the wait.
  const launching = state.phase === "checking" || state.phase === "opening";
  usePageLoading(busy);
  return <div className={styles.page}>
    <div ref={navbarRef}><NavBar email="" {...navbar} showActions={false} /></div>
    <div className={styles.body}>
    {state.phase === "docked" ? <main className={styles.canvas} aria-label="VS Code workspace" /> : launching ? <main className={styles.canvas} aria-label="VS Code" aria-busy="true" /> : <main className={styles.content} aria-label="VS Code">
      <h1>Code</h1>
      {state.phase === "unsupported" ? <p className={styles.message}>{available
        ? "The Code tab is available in Breadboard for Windows."
        : "Open this page in the latest Breadboard desktop app for Windows to use Code."}</p>
        : <>
          {state.phase === "detached" && <p className={styles.message}>VS Code has returned to its own window. Your work stays open there.</p>}
          <div className={styles.actions}>
            {state.executable && !state.canDownloadFallback ? <button disabled={busy} onClick={() => void act("open")}><RotateCcw size={15} />{state.phase === "error" ? "Retry" : state.phase === "detached" ? "Open another Code window" : "Open VS Code"}</button>
              : <button disabled={busy} onClick={() => void act("download")}><Download size={15} />Download and open VS Code</button>}
            <button disabled={busy} className={styles.secondary} onClick={() => void act("choose-installation")}><FolderOpen size={15} />Choose installation</button>
          </div>
          {state.phase === "downloading" && <p className={styles.message} role="status">Downloading from Microsoft{state.progress !== undefined ? ` · ${state.progress}%` : ""}</p>}
          {state.phase === "extracting" && <p className={styles.message} role="status">Download verified. Preparing your local copy.</p>}
          {state.phase === "error" && <p className={styles.error} role="alert">{state.error}</p>}
          {(!state.executable || state.canDownloadFallback) && <p className={styles.fine}><a href="https://code.visualstudio.com/license" target="_blank" rel="noreferrer">Microsoft license</a> · <a href="https://privacy.microsoft.com/privacystatement" target="_blank" rel="noreferrer">Privacy</a></p>}
        </>}
    </main>}
    {breadOpen ? <aside ref={railRef} className={styles.bread} aria-label="Bread">
      <header><span>Bread</span><button type="button" aria-label="Hide Bread" title="Hide Bread" onClick={toggleBread}><PanelRightClose size={15} /></button></header>
      <DashboardAgentTerminal scope="mine" restoreOwnerKey="code" presentation="drawer" />
    </aside> : <button type="button" className={styles.breadToggle} aria-label="Show Bread" title="Show Bread" onClick={toggleBread}><PanelRightOpen size={15} /></button>}
    </div>
  </div>;
}
