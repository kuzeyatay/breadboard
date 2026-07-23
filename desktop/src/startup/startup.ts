// Startup screen renderer script. Compiled as a plain (non-module) script so
// it runs directly in the sandboxed startup page under a strict CSP.

interface StartupServiceViewLocal {
  id: string;
  displayName: string;
  required: boolean;
  state: string;
  lastError: string | null;
  restarts: number;
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

let failedServiceId: string | null = null;

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
  phaseMessage.textContent = state.message;
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
      stateSpan.textContent = stateLabel(service.state);
      item.append(dot, name, stateSpan);
      return item;
    }),
  );

  if (state.failure) {
    failedServiceId = state.failure.serviceId;
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
retryButton.addEventListener("click", () => {
  if (failedServiceId !== null) void api.retryService(failedServiceId);
});
openLogsButton.addEventListener("click", () => void api.openLogsFolder());
copyDiagnosticsButton.addEventListener("click", () => void api.copyDiagnostics());
quitButton.addEventListener("click", () => void api.quit());

api.onStartupState(renderStartupState);
void api.getStartupState().then(renderStartupState);
void api.getVersions().then((versions) => {
  versionLabel.textContent = `Breadboard ${versions.app}`;
});
