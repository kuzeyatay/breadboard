// Startup screen renderer script. Compiled as a plain (non-module) script so
// it runs directly in the sandboxed startup page under a strict CSP.

interface StartupServiceViewLocal {
  id: string;
  displayName: string;
  required: boolean;
  state: string;
  lastError: string | null;
  restarts: number;
  adopted?: boolean;
}

interface StartupStateViewLocal {
  phase: "preparing" | "starting" | "ready" | "failed";
  message: string;
  services: StartupServiceViewLocal[];
  failure?: {
    serviceId: string;
    displayName: string;
    reason: string;
    logTail: string[];
  };
}

interface BreadboardDesktopApiLocal {
  getVersions(): Promise<{ app: string; electron: string }>;
  onStartupState(listener: (state: StartupStateViewLocal) => void): () => void;
  getStartupState(): Promise<StartupStateViewLocal>;
  retryService(serviceId: string): Promise<boolean>;
  openLogsFolder(): Promise<void>;
  copyDiagnostics(): Promise<void>;
  quit(): Promise<void>;
  continueToDashboard(): Promise<void>;
  awaitDashboardReady(): Promise<void>;
  getStartupSound(): Promise<boolean>;
}

interface WelcomeGreeting {
  text: string;
  lang: string;
  dir?: "rtl";
}

const api = (window as unknown as { breadboardDesktop: BreadboardDesktopApiLocal })
  .breadboardDesktop;

const kineticField = document.getElementById("kinetic-field") as HTMLDivElement;
const phaseMessage = document.getElementById("phase-message") as HTMLParagraphElement;
const serviceList = document.getElementById("service-list") as HTMLUListElement;
const failureSection = document.getElementById("failure") as HTMLElement;
const failureTitle = document.getElementById("failure-title") as HTMLHeadingElement;
const failureReason = document.getElementById("failure-reason") as HTMLParagraphElement;
const failureLog = document.getElementById("failure-log") as HTMLPreElement;
const retryButton = document.getElementById("retry-button") as HTMLButtonElement;
const openLogsButton = document.getElementById("open-logs-button") as HTMLButtonElement;
const copyDiagnosticsButton = document.getElementById(
  "copy-diagnostics-button",
) as HTMLButtonElement;
const quitButton = document.getElementById("quit-button") as HTMLButtonElement;
const versionLabel = document.getElementById("version-label") as HTMLSpanElement;
const introSound = document.getElementById("intro-sound") as HTMLAudioElement;
const welcomeSection = document.getElementById("welcome") as HTMLElement;
const welcomeContinue = document.getElementById("welcome-continue") as HTMLButtonElement;
const dissolveBloom = document.getElementById("dissolve-bloom") as HTMLDivElement;
const welcomeWords = Array.from(
  document.querySelectorAll<HTMLParagraphElement>(".welcome-word"),
);

/** English first — the rest cycle in the order below until they run out. */
const WELCOME_GREETINGS: WelcomeGreeting[] = [
  { text: "Welcome", lang: "en" },
  { text: "Hoş geldin", lang: "tr" },
  { text: "Bienvenue", lang: "fr" },
  { text: "Bienvenido", lang: "es" },
  { text: "Willkommen", lang: "de" },
  { text: "ようこそ", lang: "ja" },
  { text: "Benvenuto", lang: "it" },
  { text: "환영합니다", lang: "ko" },
  { text: "Bem-vindo", lang: "pt" },
  { text: "Добро пожаловать", lang: "ru" },
  { text: "欢迎", lang: "zh" },
  { text: "أهلا بك", lang: "ar", dir: "rtl" },
  { text: "Welkom", lang: "nl" },
  { text: "स्वागत है", lang: "hi" },
  { text: "Καλώς ορίσατε", lang: "el" },
  { text: "ברוך הבא", lang: "he", dir: "rtl" },
  { text: "Välkommen", lang: "sv" },
  { text: "Witamy", lang: "pl" },
  { text: "ยินดีต้อนรับ", lang: "th" },
  { text: "Chào mừng", lang: "vi" },
];

// The 620ms entrance leaves a long, quiet plateau for each translation to be
// read before the next crossfade begins.
const GREETING_HOLD_MS = 4_200;
const WELCOME_REVEAL_DELAY_MS = 420;
/** With the chime leading it in, the greeting waits a beat longer so the sound
 *  starts first and the word lands into it. It costs nothing in real
 *  time-to-app: the screen is waiting on a click either way. */
const INTRO_WELCOME_REVEAL_DELAY_MS = 1_200;
const DISSOLVE_MS = 860;
const REDUCED_DISSOLVE_MS = 240;

let failedServiceId: string | null = null;
let stage: "loading" | "preparing" | "welcome" | "dissolving" = "loading";
let introPlaying = false;
/**
 * Whether the chime may sound at all, switched off on the Profile page. It is
 * asked for as the page loads and held by the shell rather than read from
 * anywhere the dashboard keeps settings — this screen runs before the dashboard
 * exists and before anyone has signed in.
 *
 * A shell that cannot answer leaves the sound on: muting is a deliberate
 * choice, and a failed lookup is not one.
 */
let introEnabled = true;
// Asked for through a resolved promise rather than called outright: a shell too
// old to answer would otherwise throw here, on the first statements of the only
// screen the app has, and take the whole launch down over a chime.
const introPreference = Promise.resolve()
  .then(() => api.getStartupSound())
  .then(
    (enabled) => {
      introEnabled = enabled !== false;
    },
    () => undefined,
  );
/** Bumped whenever the screen leaves the pre-welcome wait, so a dashboard that
 *  finishes painting after a service died cannot open the greeting anyway. */
let gateToken = 0;
let greetingTimer: number | null = null;
let greetingIndex = 0;
let activeWordSlot = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * "Добро пожаловать" cannot wear the same type size as "欢迎". Shrink long
 * greetings first by character count, then measure and shrink again if the
 * window is narrow enough that they would still run off the edge.
 */
function fitGreeting(element: HTMLParagraphElement, text: string): void {
  const length = [...text].length;
  const scale = length <= 9 ? 1 : Math.max(0.5, Math.sqrt(9 / length));
  element.style.setProperty("--word-scale", scale.toFixed(3));
  const available = element.parentElement?.clientWidth ?? 0;
  const measured = element.scrollWidth;
  if (available > 0 && measured > available) {
    element.style.setProperty("--word-scale", (scale * (available / measured) * 0.98).toFixed(3));
  }
}

function showGreeting(greeting: WelcomeGreeting): void {
  const outgoing = welcomeWords[activeWordSlot];
  activeWordSlot = activeWordSlot === 0 ? 1 : 0;
  const incoming = welcomeWords[activeWordSlot];
  if (!incoming) return;
  incoming.textContent = greeting.text;
  incoming.lang = greeting.lang;
  incoming.dir = greeting.dir ?? "ltr";
  incoming.classList.remove("is-entering", "is-leaving");
  fitGreeting(incoming, greeting.text);
  // Re-adding the class in the same frame would not restart the animation.
  void incoming.offsetWidth;
  incoming.classList.add("is-entering");
  if (outgoing && outgoing !== incoming && outgoing.textContent) {
    outgoing.classList.remove("is-entering");
    outgoing.classList.add("is-leaving");
  }
}

/**
 * The chime the greeting arrives over. It plays once, unprompted — the only
 * things that can refuse it are the person's own preference and an autoplay
 * policy, and a silent start is a complete outcome either way, so a rejection
 * is simply noted and dropped.
 *
 * `introPlaying` records that it was started rather than that it is still
 * sounding: what the rest of the screen needs to know is whether a chime is
 * leading the greeting in, which stays true for the beat after it ends. A muted
 * screen therefore leaves it false, and the greeting arrives on the shorter
 * delay it would have used before there was a sound to wait for.
 */
function startIntro(): void {
  if (!introEnabled || introPlaying) return;
  introPlaying = true;
  void introSound.play().catch(() => {
    introPlaying = false;
  });
}

function stopIntro(): void {
  if (!introPlaying) return;
  introPlaying = false;
  introSound.pause();
  introSound.currentTime = 0;
}

function stopGreetings(): void {
  if (greetingTimer !== null) {
    window.clearInterval(greetingTimer);
    greetingTimer = null;
  }
}

/**
 * Every service is healthy, but the dashboard is only now being rendered into a
 * hidden window behind this screen. Stay on the loading field until it has
 * actually painted. The greeting is the last thing before the handoff, so
 * holding it back until there is a finished page to hand off to is what makes
 * the click open the app instantly instead of opening a wait.
 */
function beginWelcomeGate(): void {
  if (stage !== "loading") return;
  stage = "preparing";
  document.body.dataset["stage"] = "preparing";
  const token = gateToken;
  const open = () => {
    if (token === gateToken) enterWelcome();
  };
  // The chime preference is settled first. It decides both whether a sound
  // plays and how long the greeting holds back for one, so an answer arriving
  // mid-welcome would be an answer arriving too late — and since it is asked
  // for as the page loads, this costs nothing against the dashboard's own wait.
  //
  // Both arms: the shell caps this wait rather than reporting failure, so a
  // rejection means the channel itself is gone — and never showing the welcome
  // would be a worse outcome than showing it over a dashboard still painting.
  void introPreference.then(() => api.awaitDashboardReady().then(open, open));
}

function enterWelcome(): void {
  if (stage !== "preparing") return;
  stage = "welcome";
  document.body.dataset["stage"] = "welcome";
  phaseMessage.textContent = "Ready";
  // Loading ends here, not when the services went healthy: this is the frame
  // the leaf field stops being a progress indicator on. The chime sounds on it,
  // and the greeting follows a beat later — so however long the dashboard took
  // to paint behind this screen, the sound still lands on the finish.
  startIntro();
  window.setTimeout(() => {
    if (stage !== "welcome") return;
    welcomeSection.hidden = false;
    requestAnimationFrame(() => welcomeSection.classList.add("is-visible"));
    greetingIndex = 0;
    const first = WELCOME_GREETINGS[0];
    if (first) showGreeting(first);
    greetingTimer = window.setInterval(() => {
      greetingIndex = (greetingIndex + 1) % WELCOME_GREETINGS.length;
      const greeting = WELCOME_GREETINGS[greetingIndex];
      if (greeting) showGreeting(greeting);
    }, GREETING_HOLD_MS);
  }, introPlaying ? INTRO_WELCOME_REVEAL_DELAY_MS : WELCOME_REVEAL_DELAY_MS);
}

/** A service died after everything looked healthy: the failure card outranks
 *  the greeting, and its buttons must not sit under a full-screen click target.
 *  It also outranks a dashboard that is still loading towards one. */
function abandonWelcome(): void {
  if (stage !== "welcome" && stage !== "preparing") return;
  stopGreetings();
  // The failure card outranks the chime too — a startup sound under "a service
  // could not start" says the opposite of what the card says.
  stopIntro();
  // Retires any dashboard wait still outstanding, and any that a later retry
  // starts is a new one — the old preload was discarded with the failure.
  gateToken += 1;
  stage = "loading";
  document.body.dataset["stage"] = "loading";
  welcomeSection.classList.remove("is-visible");
  welcomeSection.hidden = true;
}

/**
 * The click. The dissolve hands the window to the dashboard, and the greeting
 * was not shown until that dashboard had finished painting behind this screen —
 * so there is nothing left to wait for and the bloom starts on this frame.
 *
 * `viewportX`/`viewportY` are where the click landed; the light blooms from
 * there. A keyboard press has no point, so it blooms from the middle.
 */
function dissolve(viewportX: number | null, viewportY: number | null): void {
  if (stage !== "welcome") return;
  stage = "dissolving";
  stopGreetings();
  // Silence it on the click: a chime still inside its three seconds would
  // otherwise carry on over the dashboard it was announcing.
  introSound.pause();
  welcomeContinue.disabled = true;
  const bounds = dissolveBloom.getBoundingClientRect();
  const originX = viewportX === null ? bounds.width / 2 : viewportX - bounds.left;
  const originY = viewportY === null ? bounds.height / 2 : viewportY - bounds.top;
  dissolveBloom.style.setProperty("--bloom-x", `${originX}px`);
  dissolveBloom.style.setProperty("--bloom-y", `${originY}px`);
  document.body.dataset["stage"] = "dissolving";
  window.setTimeout(
    () => void api.continueToDashboard(),
    prefersReducedMotion() ? REDUCED_DISSOLVE_MS : DISSOLVE_MS,
  );
}

function createKineticField(): void {
  const rowSizes = [5, 7, 8, 7, 5];
  kineticField.replaceChildren(
    ...rowSizes.map((size) => {
      const row = document.createElement("div");
      row.className = "kinetic-row";
      for (let index = 0; index < size; index += 1) {
        const scale = document.createElement("span");
        scale.className = "kinetic-scale";
        row.append(scale);
      }
      return row;
    }),
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case "pending":
      return "waiting";
    case "starting":
      return "starting";
    case "healthy":
      return "ready";
    case "degraded":
      return "restarting";
    case "failed":
      return "failed";
    default:
      return state;
  }
}

function renderStartupState(state: StartupStateViewLocal): void {
  document.body.dataset["phase"] = state.phase;
  if (state.phase === "ready") beginWelcomeGate();
  else if (state.phase === "failed") abandonWelcome();
  // The shell calls itself ready as soon as the services are, which is a whole
  // dashboard render before this screen is done. Announce what is happening.
  phaseMessage.textContent =
    stage === "preparing" ? "Opening your workspace" : state.message;
  serviceList.replaceChildren(
    ...state.services.map((service) => {
      const item = document.createElement("li");
      item.dataset["state"] = service.state;
      const dot = document.createElement("span");
      dot.className = "dot";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = service.displayName + (service.required ? "" : " (optional)");
      const stateSpan = document.createElement("span");
      stateSpan.className = "state";
      // An adopted service was found already running; saying "ready" would hide
      // that this launch is reusing someone else's process.
      stateSpan.textContent =
        service.adopted && service.state === "healthy"
          ? "already running"
          : stateLabel(service.state);
      item.append(dot, name, stateSpan);
      return item;
    }),
  );

  if (state.failure) {
    failedServiceId = state.failure.serviceId;
    retryButton.disabled = false;
    failureTitle.textContent = `${state.failure.displayName} could not start`;
    failureReason.textContent = state.failure.reason;
    failureLog.textContent = state.failure.logTail.join("\n") || "(no log output captured)";
    failureSection.hidden = false;
  } else {
    failedServiceId = null;
    failureSection.hidden = true;
  }
}

createKineticField();
welcomeContinue.addEventListener("click", (event) => {
  const keyboardActivated = event.detail === 0;
  dissolve(
    keyboardActivated ? null : event.clientX,
    keyboardActivated ? null : event.clientY,
  );
});
// Keep Space as a convenient, undisplayed shortcut from anywhere on the
// screen. The bloom has no point to grow from on a key, so it opens from the
// middle. `dissolve` ignores the synthetic click a focused button would still
// raise on the key's release.
window.addEventListener("keydown", (event) => {
  if (stage !== "welcome") return;
  if (event.key !== " " && event.key !== "Spacebar") return;
  if (event.repeat) return;
  event.preventDefault();
  dissolve(null, null);
});
retryButton.addEventListener("click", async () => {
  const serviceId = failedServiceId;
  if (serviceId === null || retryButton.disabled) return;
  retryButton.disabled = true;
  try {
    const accepted = await api.retryService(serviceId);
    // A rejected retry leaves the same failure card in place. Restore its
    // action even when no new startup-state event was needed to redraw it.
    if (!accepted && failedServiceId === serviceId) retryButton.disabled = false;
  } catch {
    if (failedServiceId === serviceId) retryButton.disabled = false;
  }
});
openLogsButton.addEventListener("click", () => void api.openLogsFolder());
copyDiagnosticsButton.addEventListener("click", () => void api.copyDiagnostics());
quitButton.addEventListener("click", () => void api.quit());

api.onStartupState(renderStartupState);
void api.getStartupState().then(renderStartupState);
void api.getVersions().then((versions) => {
  versionLabel.textContent = `Breadboard ${versions.app}`;
});
