export interface ClickyLauncherState {
  supported: boolean;
  available: boolean;
  projectAvailable: boolean;
  status: "ready" | "unsupported" | "not_built" | "not_found";
  message: string;
}

export interface ClickyLaunchResult {
  ok: boolean;
  code:
    | "launched"
    | "unsupported"
    | "not_built"
    | "not_found"
    | "launch_failed"
    | "project_opened"
    | "project_open_failed";
  message: string;
  state: ClickyLauncherState;
}

export interface ClickyDesktopControl {
  read(): Promise<ClickyLauncherState>;
  launch(): Promise<ClickyLaunchResult>;
  openProject(): Promise<ClickyLaunchResult>;
}

interface DesktopClickyBridge {
  getClickyState?: () => Promise<ClickyLauncherState>;
  launchClicky?: () => Promise<ClickyLaunchResult>;
  openClickyProject?: () => Promise<ClickyLaunchResult>;
  publishNotificationToast?: (notice: {
    title: string;
    message: string;
    type: "success" | "error";
  }) => Promise<boolean>;
}

function bridge(): DesktopClickyBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopClickyBridge })
    .breadboardDesktop;
}

export function publishClickyNotification(
  message: string,
  type: "success" | "error",
): void {
  void bridge()?.publishNotificationToast?.({ title: "Clicky", message, type });
}

/** The native launcher, or null in an ordinary browser or an older shell. */
export function clickyDesktopControl(): ClickyDesktopControl | null {
  const desktop = bridge();
  const read = desktop?.getClickyState;
  const launch = desktop?.launchClicky;
  const openProject = desktop?.openClickyProject;
  if (
    typeof read !== "function" ||
    typeof launch !== "function" ||
    typeof openProject !== "function"
  ) {
    return null;
  }
  return {
    read: () => read.call(desktop),
    launch: () => launch.call(desktop),
    openProject: () => openProject.call(desktop),
  };
}

const DIRECT_CLICKY_LAUNCH_PROMPT = new RegExp(
  [
    "^(?:",
    "\\/clicky",
    "|",
    "(?:please[,:]?\\s+)?",
    "(?:(?:can|could|would)\\s+you\\s+)?",
    "(?:please[,:]?\\s+)?",
    "(?:launch|open|start|run)(?:\\s+up)?\\s+",
    "(?:the\\s+)?clicky(?:\\s+app)?",
    "(?:\\s+(?:for\\s+me|now|please))?",
    ")[.!?]*$",
  ].join(""),
  "iu",
);

/**
 * Only a direct launch instruction is consumed. Questions, negations and
 * multi-part requests stay normal chat turns so a useful prompt is never lost.
 */
export function isDirectClickyLaunchPrompt(value: string): boolean {
  return DIRECT_CLICKY_LAUNCH_PROMPT.test(value.trim());
}

/**
 * Launch Clicky from the shared composer; only failures need a toast.
 * True means the prompt was fully handled and
 * must not also be submitted as an AI turn.
 */
export function launchClickyFromPrompt(value: string): boolean {
  if (!isDirectClickyLaunchPrompt(value)) return false;
  const desktop = bridge();
  const launchClicky = desktop?.launchClicky;
  if (!clickyDesktopControl() || typeof launchClicky !== "function") return false;
  void launchClicky
    .call(desktop)
    .then((launch) => {
      if (!launch.ok) publishClickyNotification(launch.message, "error");
    })
    .catch(() => {
      publishClickyNotification(
        "Breadboard could not reach the Clicky launcher.",
        "error",
      );
    });
  return true;
}
