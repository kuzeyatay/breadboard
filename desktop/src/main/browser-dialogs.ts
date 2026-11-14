import {
  BrowserWindow,
  desktopCapturer,
  shell,
  webContents as allWebContents,
  type DesktopCapturerSource,
  type Session,
  type WebContents,
} from "electron";

/**
 * Browser features Chromium leaves to the embedder: HTTP sign-in, window.prompt,
 * links that open desktop apps, and the screen-share picker. Electron has no
 * UI for any of them, so without these pages simply fail.
 */

const SUBMIT = "https://breadboard-dialog.invalid/";
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, ch => `&#${ch.charCodeAt(0)};`);

interface Field { name: string; label: string; type?: "text" | "password"; value?: string }

function parentFor(contents: WebContents): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.fromWebContents(contents) ?? undefined;
}

/** The app's own light/dark choice, which may differ from the system's. */
let dialogTheme: () => "light" | "dark" = () => "light";
export function setBrowserDialogTheme(theme: () => string): void {
  dialogTheme = () => (theme() === "dark" ? "dark" : "light");
}

export interface HtmlDialogOptions {
  /** Blocks the window until answered (default). A corner notice does not. */
  modal?: boolean;
  /** Sits at the top right of the window instead of its centre, without taking focus. */
  corner?: boolean;
  /** Dismisses itself, as if cancelled, after this long. */
  timeoutMs?: number;
  /** Takes the height of its content instead of `size.height`. */
  fit?: boolean;
}

const DIALOG_STYLE = `:root{--bg:#f7fbf7;--fg:#13201b;--muted:#51635a;--line:#bccfc2;--accent:#4f6f68;--on-accent:#fff;--field:#fff;--danger:#a4311f}
:root[data-theme=dark]{--bg:#151916;--fg:#d2d9d0;--muted:#93a097;--line:#2c352f;--accent:#9ac6ac;--on-accent:#0f1210;--field:#0f1210;--danger:#e58a78}
html{background:var(--bg);color:var(--fg);color-scheme:light}html[data-theme=dark]{color-scheme:dark}
body{font:14px/1.45 "Source Sans 3","Source Sans Pro","Segoe UI",system-ui,sans-serif;margin:0;padding:18px 20px 16px;border:1px solid var(--line);border-radius:10px;box-sizing:border-box}
h1{font-size:15px;font-weight:650;margin:0 0 8px;-webkit-app-region:drag;user-select:none}
p{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto}
p.detail{color:var(--muted);font-size:12.5px}
label{display:block;margin-bottom:10px;font-size:13px;color:var(--muted)}
label.check{display:flex;gap:8px;align-items:center;margin:4px 0 0}
input:not([type=checkbox]){display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:7px 9px;font:inherit;color:var(--fg);background:var(--field);border:1px solid var(--line);border-radius:8px}
input[type=checkbox]{accent-color:var(--accent)}
.row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
.col{display:flex;flex-direction:column;gap:6px;margin-top:12px}.col button{text-align:left}
button{font:inherit;font-weight:550;padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button:hover{border-color:var(--accent)}button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.danger{color:var(--danger)}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}`;

/**
 * A Breadboard-styled popup built from trusted HTML: frameless, themed, and
 * placed over the window that asked. It answers by navigating to
 * `${SUBMIT}ok?...` (resolves the query) or `${SUBMIT}cancel` (null).
 */
export function showHtmlDialog(
  contents: WebContents,
  title: string,
  body: string,
  size: { width: number; height: number },
  options: HtmlDialogOptions = {},
): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    const parent = parentFor(contents);
    const dark = dialogTheme() === "dark";
    const window = new BrowserWindow({
      parent, modal: Boolean(parent) && options.modal !== false && !options.corner,
      width: size.width, height: Math.round(size.height), useContentSize: true,
      frame: false, resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      autoHideMenuBar: true, title, show: false, backgroundColor: dark ? "#151916" : "#f7fbf7",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: Record<string, string> | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
      if (!window.isDestroyed()) window.destroy();
    };
    if (options.timeoutMs) timer = setTimeout(() => finish(null), options.timeoutMs);
    window.on("closed", () => finish(null));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // The form "submits" to an address that is never loaded: the navigation is
    // the only channel, so this page needs no preload or IPC.
    window.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      if (!url.startsWith(SUBMIT)) return;
      const parsed = new URL(url);
      finish(parsed.pathname === "/ok" ? Object.fromEntries(parsed.searchParams) : null);
    });
    const place = (height: number) => {
      window.setContentSize(size.width, Math.round(height));
      if (!parent || parent.isDestroyed()) return;
      const area = parent.getContentBounds();
      window.setPosition(
        Math.round(options.corner ? area.x + area.width - size.width - 16 : area.x + (area.width - size.width) / 2),
        Math.round(options.corner ? area.y + 96 : area.y + Math.max(24, (area.height - height) / 2)),
      );
    };
    const html = `<!doctype html><html data-theme="${dark ? "dark" : "light"}"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action ${SUBMIT}">
<style>${DIALOG_STYLE}</style>
<h1>${escapeHtml(title)}</h1>
${body}
<script>const cancel=()=>location.href=${JSON.stringify(`${SUBMIT}cancel`)};for(const b of document.querySelectorAll("[data-cancel]"))b.onclick=cancel;
addEventListener("keydown",e=>{if(e.key==="Escape")cancel()});</script></html>`;
    window.webContents.once("did-finish-load", () => {
      const reveal = (height: number) => {
        if (window.isDestroyed()) return;
        place(height);
        // A corner notice must not take the keyboard from the page being typed in.
        if (options.corner) window.showInactive(); else window.show();
      };
      if (!options.fit) return reveal(size.height);
      window.webContents.executeJavaScript("Math.ceil(document.body.getBoundingClientRect().height)")
        .then(height => reveal(Math.max(80, Math.min(Number(height) || size.height, 640))), () => reveal(size.height));
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => finish(null));
  });
}

/** A small modal form. Resolves the field values, or null when cancelled. */
export function showFormDialog(
  contents: WebContents,
  title: string,
  message: string,
  fields: Field[],
): Promise<Record<string, string> | null> {
  const inputs = fields.map((field, index) => `<label>${escapeHtml(field.label)}
    <input name="${escapeHtml(field.name)}" type="${field.type ?? "text"}" value="${escapeHtml(field.value ?? "")}" ${index === 0 ? "autofocus" : ""}></label>`).join("");
  return showHtmlDialog(contents, title, `<form method="get" action="${SUBMIT}ok"><p>${escapeHtml(message)}</p>${inputs}
<div class="row"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">OK</button></div></form>`,
  { width: 420, height: 160 + fields.length * 58 + Math.min(message.length, 400) / 2 }, { fit: true });
}

export interface ChoiceDialog {
  title: string;
  message: string;
  detail?: string;
  /** In the order they are shown; the main action goes last. */
  buttons: string[];
  /** The button that also answers Escape, a timeout and closing the popup. */
  cancel: number;
  primary?: number;
  danger?: number;
  checkbox?: string;
  /** One button per row, for lists such as devices. */
  stacked?: boolean;
  modal?: boolean;
  corner?: boolean;
  timeoutMs?: number;
}

/** Breadboard's replacement for a native message box. */
export async function showChoiceDialog(
  contents: WebContents,
  choice: ChoiceDialog,
): Promise<{ response: number; checked: boolean }> {
  const buttons = choice.buttons.map((label, index) => {
    const classes = [index === choice.primary ? "primary" : "", index === choice.danger ? "danger" : ""].filter(Boolean).join(" ");
    return index === choice.cancel
      ? `<button type="button" data-cancel class="${classes}"${index === choice.primary ? " autofocus" : ""}>${escapeHtml(label)}</button>`
      : `<button type="submit" name="response" value="${index}" class="${classes}"${index === choice.primary ? " autofocus" : ""}>${escapeHtml(label)}</button>`;
  }).join("");
  const answer = await showHtmlDialog(contents, choice.title, `<form method="get" action="${SUBMIT}ok"><p>${escapeHtml(choice.message)}</p>
${choice.detail ? `<p class="detail">${escapeHtml(choice.detail)}</p>` : ""}
${choice.checkbox ? `<label class="check"><input type="checkbox" name="checked" value="1">${escapeHtml(choice.checkbox)}</label>` : ""}
<div class="${choice.stacked ? "col" : "row"}">${buttons}</div></form>`,
  { width: 440, height: 220 }, { fit: true, modal: choice.modal, corner: choice.corner, timeoutMs: choice.timeoutMs });
  const response = Number(answer?.response);
  return answer && Number.isInteger(response) && response >= 0 && response < choice.buttons.length
    ? { response, checked: answer.checked === "1" }
    : { response: choice.cancel, checked: false };
}

/** Basic/Digest/NTLM sign-in for a site or proxy, like Chrome's sign-in sheet. */
export function handleBrowserLogin(contents: WebContents): void {
  contents.on("login", (event, details, authInfo, callback) => {
    event.preventDefault();
    const where = authInfo.isProxy ? `the proxy ${authInfo.host}:${authInfo.port}` : new URL(details.url).origin;
    void showFormDialog(contents, "Sign in", `${where} requires a username and password.${authInfo.realm ? `\nRealm: ${authInfo.realm}` : ""}`, [
      { name: "username", label: "Username" },
      { name: "password", label: "Password", type: "password" },
    ]).then(values => values ? callback(values.username, values.password) : callback());
  });
}

/** Synchronous window.prompt(), answered from the browser preload's sendSync. */
export function handleBrowserPrompt(contents: WebContents): void {
  contents.ipc.on("breadboard:web-dialog:prompt", (event, message: unknown, value: unknown) => {
    const origin = (() => { try { return new URL(event.senderFrame?.url || contents.getURL()).origin; } catch { return "This page"; } })();
    void showFormDialog(contents, origin, String(message ?? "").slice(0, 4_000), [
      { name: "value", label: "", value: String(value ?? "").slice(0, 4_000) },
    ]).then(values => { event.returnValue = values ? values.value ?? "" : null; }, () => { event.returnValue = null; });
  });
}

// Chromium's own list of schemes a page may never hand to the OS, plus
// Windows handlers that have been used to run code (Follina, search-ms, ...).
const BLOCKED_APP_SCHEMES = new Set([
  "javascript", "vbscript", "data", "blob", "file", "filesystem", "about", "chrome", "chrome-extension",
  "devtools", "view-source", "shell", "hcp", "ms-msdt", "search-ms", "search", "ms-officecmd", "ms-appinstaller",
  "ms-cxh", "ms-cxh-full", "its", "mk", "ms-its", "jar", "ldap", "res", "ms-settings",
]);
/** Saved "Always allow" app-link choices; browser preferences install the durable one. */
export interface AppLinkStore { allowed(origin: string, scheme: string): boolean; allow(origin: string, scheme: string): void }
const sessionAppLinks = new Map<string, Set<string>>();
let appLinkStore: AppLinkStore = {
  allowed: (origin, scheme) => sessionAppLinks.get(origin)?.has(scheme) === true,
  allow: (origin, scheme) => { sessionAppLinks.set(origin, (sessionAppLinks.get(origin) ?? new Set()).add(scheme)); },
};
export function setAppLinkStore(store: AppLinkStore): void { appLinkStore = store; }

export function isAppLaunchUrl(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/iu.exec(url);
  if (!match) return false;
  const scheme = match[1]!.toLowerCase();
  // breadboard-selection: and breadboard-annotation: are how a page reports a
  // text selection to this app (cancelled in will-navigate). They are never a
  // link to another application, and asking about one on every selection made
  // it impossible to select text.
  return scheme !== "http" && scheme !== "https" && !scheme.startsWith("breadboard") && !BLOCKED_APP_SCHEMES.has(scheme);
}

/** "Open Zoom?" — ask, then hand the link to the operating system. */
export async function confirmOpenApp(contents: WebContents, url: string): Promise<boolean> {
  if (!isAppLaunchUrl(url) || url.length > 8_192) return false;
  const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
  let origin = "This site";
  try { origin = new URL(contents.getURL()).origin; } catch { /* keep generic */ }
  if (!appLinkStore.allowed(origin, scheme)) {
    const answer = await showChoiceDialog(contents, {
      title: "Open application?", message: `${origin} wants to open a "${scheme}:" link in another application.`,
      detail: url.length > 300 ? `${url.slice(0, 300)}…` : url,
      checkbox: `Always allow ${origin} to open ${scheme}: links`,
      buttons: ["Cancel", "Open"], cancel: 0, primary: 1,
    });
    if (answer.response !== 1) return false;
    if (answer.checked) appLinkStore.allow(origin, scheme);
  }
  await shell.openExternal(url).catch(() => undefined);
  return true;
}

/** getDisplayMedia: Chrome's "Choose what to share" with live thumbnails. */
export function installScreenSharePicker(target: Session, allowedPage: (contents: WebContents) => boolean): void {
  target.setDisplayMediaRequestHandler((request, callback) => {
    const deny = () => { try { callback({}); } catch { /* Electron 33 throws while denying */ } };
    const frame = request.frame;
    const contents = frame ? allWebContents.fromFrame(frame) : undefined;
    if (!frame || !contents || contents.isDestroyed() || !allowedPage(contents)) return deny();
    const thumbnailSize = { width: 240, height: 135 };
    void Promise.all([
      desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize }),
      contents.capturePage().then(image => image.resize(thumbnailSize).toDataURL(), () => ""),
    ]).then(async ([sources, tabThumbnail]) => {
      const ownWindows = new Set(BrowserWindow.getAllWindows().map(window => window.getMediaSourceId()));
      const screens = sources.filter(source => source.id.startsWith("screen:"));
      const windows = sources.filter(source => source.id.startsWith("window:") && !ownWindows.has(source.id) && source.name);
      const choices: Array<{ label: string; image: string; source?: DesktopCapturerSource }> = [
        { label: "This tab", image: tabThumbnail },
        ...screens.map((source, index) => ({ label: screens.length > 1 ? `Entire screen ${index + 1}` : "Entire screen", image: source.thumbnail.toDataURL(), source })),
        ...windows.map(source => ({ label: source.name, image: source.thumbnail.toDataURL(), source })),
      ];
      let origin = "This site";
      try { origin = new URL(request.securityOrigin || contents.getURL()).origin; } catch { /* keep generic */ }
      const tiles = choices.map((choice, index) => `<label class="tile"><input type="radio" name="pick" value="${index}" ${index === 0 ? "checked" : ""}>
        ${choice.image ? `<img src="${choice.image}" alt="">` : `<span class="blank"></span>`}<span>${escapeHtml(choice.label.slice(0, 80))}</span></label>`).join("");
      const audio = request.audioRequested ? `<label class="audio"><input type="checkbox" name="audio" value="1" checked> Also share system audio (entire screen only)</label>` : "";
      const answer = await showHtmlDialog(contents, "Share your screen", `<style>
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-height:430px;overflow:auto;padding:2px}
.tile{display:flex;flex-direction:column;gap:4px;margin:0;padding:6px;border:1px solid #8884;border-radius:8px;cursor:pointer;position:relative}
.tile:has(input:checked){outline:2px solid Highlight}.tile input{position:absolute;opacity:0}
.tile img,.blank{width:100%;aspect-ratio:16/9;object-fit:contain;background:#0002;border-radius:4px}
.tile span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.audio{display:flex;gap:6px;align-items:center;margin-top:10px}.audio input{width:auto;margin:0}</style>
<form method="get" action="${SUBMIT}ok"><p>${escapeHtml(origin)} wants to share the contents of your screen. Choose what to share.</p>
<div class="grid">${tiles}</div>${audio}
<div class="row"><button type="button" data-cancel>Cancel</button><button type="submit" autofocus>Share</button></div></form>`, { width: 820, height: 640 });
      const choice = answer ? choices[Number(answer.pick)] : undefined;
      if (!choice || contents.isDestroyed()) return deny();
      if (!choice.source) return callback({ video: contents.mainFrame });
      callback({
        video: choice.source,
        ...(answer?.audio && choice.source.id.startsWith("screen:") ? { audio: "loopback" as const } : {}),
      });
    }).catch(deny);
  });
}

/** Chrome's "Your connection is not private" with "Proceed anyway", per session. */
const certificateExceptions = new Set<string>();
export function handleCertificateErrors(contents: WebContents): void {
  contents.on("certificate-error", (event, url, error, certificate, callback, isMainFrame) => {
    event.preventDefault();
    let host = "";
    try { host = new URL(url).host; } catch { return callback(false); }
    const key = `${host}|${certificate.fingerprint}`;
    if (certificateExceptions.has(key)) return callback(true);
    // Subresources follow the decision made for the page; never prompt for them.
    if (!isMainFrame) return callback(false);
    void showChoiceDialog(contents, {
      title: "Your connection is not private",
      message: `Attackers might be trying to steal your information from ${host} (for example, passwords, messages, or credit cards).`,
      detail: `${error}\nIssued to: ${certificate.subjectName}\nIssued by: ${certificate.issuerName}\nValid until: ${new Date(certificate.validExpiry * 1000).toLocaleString()}`,
      buttons: [`Proceed to ${host} (unsafe)`, "Back to safety"], cancel: 1, primary: 1, danger: 0,
    }).then(({ response }) => {
      if (response === 0) certificateExceptions.add(key);
      callback(response === 0);
    }, () => callback(false));
  });
}

/** Never ask "Leave site?": a page that tries to block its unload just leaves. */
export function handleBeforeUnload(contents: WebContents): void {
  // preventDefault is what lets the unload go ahead.
  contents.on("will-prevent-unload", event => event.preventDefault());
}

async function pickDevice<T>(contents: WebContents | null | undefined, title: string, kind: string, devices: T[], label: (device: T) => string): Promise<T | undefined> {
  if (!contents || contents.isDestroyed()) return undefined;
  if (!devices.length) {
    await showChoiceDialog(contents, { title, message: `No compatible ${kind} found.`, detail: "Connect the device and try again.",
      buttons: ["OK"], cancel: 0, primary: 0 });
    return undefined;
  }
  let origin = "This site";
  try { origin = new URL(contents.getURL()).origin; } catch { /* keep generic */ }
  const shown = devices.slice(0, 15);
  const { response } = await showChoiceDialog(contents, {
    title, message: `${origin} wants to connect to a ${kind}.`, detail: "Choose a device.",
    buttons: [...shown.map(label), "Cancel"], cancel: shown.length, stacked: true,
  });
  return shown[response];
}

/** Device and passkey choosers. Picking an item is the consent. */
const devicePickerSessions = new WeakSet<Session>();
export function installDevicePickers(target: Session): void {
  if (devicePickerSessions.has(target)) return;
  devicePickerSessions.add(target);
  // Modern Electron delegates discoverable passkey account selection to the
  // embedder. Without a chooser, even a matching credential is cancelled.
  target.on("select-webauthn-account", (_event, details, callback) => {
    void (async () => {
      const frame = details.frame;
      const contents = frame && allWebContents.fromFrame(frame);
      if (!frame || !contents || contents.isDestroyed() || !details.accounts.length) return;
      const url = frame.url;
      const accounts = details.accounts;
      const { response } = await showChoiceDialog(contents, {
        title: "Sign in with a passkey", message: `Choose an account for ${details.relyingPartyId}.`,
        buttons: [...accounts.map(account => account.name && account.displayName && account.name !== account.displayName
          ? `${account.displayName} (${account.name})` : account.name || account.displayName || "Passkey"), "Cancel"],
        cancel: accounts.length, stacked: true,
      });
      if (contents.isDestroyed() || frame.detached || frame.url !== url) return;
      return accounts[response]?.credentialId;
    })().then(credential => callback(credential), () => callback());
  });
  target.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    void pickDevice(details.frame ? allWebContents.fromFrame(details.frame) : undefined, "Connect a device", "HID device", details.deviceList,
      device => device.name || `Device ${device.vendorId.toString(16)}:${device.productId.toString(16)}`)
      .then(device => callback(device?.deviceId ?? null), () => callback(null));
  });
  target.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    void pickDevice(details.frame ? allWebContents.fromFrame(details.frame) : undefined, "Connect a device", "USB device", details.deviceList,
      device => device.productName || `Device ${device.vendorId.toString(16)}:${device.productId.toString(16)}`)
      .then(device => callback(device?.deviceId), () => callback());
  });
  target.on("select-serial-port", (event, portList, webContents, callback) => {
    event.preventDefault();
    void pickDevice(webContents, "Connect a serial port", "serial port", portList,
      port => port.displayName || port.portName || port.portId)
      .then(port => callback(port?.portId ?? ""), () => callback(""));
  });
}

/** Web Bluetooth: devices arrive while Chromium scans, so collect, then choose. */
export function handleBluetoothPicker(contents: WebContents): void {
  let pending: { devices: Electron.BluetoothDevice[] } | null = null;
  contents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    if (pending) { pending.devices = devices; return; }
    // ponytail: a fixed 4 s scan, then a static list; rescan by retrying in the page.
    const scan = { devices };
    pending = scan;
    setTimeout(() => {
      pending = null;
      void pickDevice(contents, "Pair a Bluetooth device", "Bluetooth device", scan.devices, device => device.deviceName || device.deviceId)
        .then(device => callback(device?.deviceId ?? ""), () => callback(""));
    }, 4_000);
  });
}
