export const IPC_CHANNELS = {
  getVersions: "breadboard:get-versions",
  getStartupState: "breadboard:get-startup-state",
  retryService: "breadboard:retry-service",
  openLogs: "breadboard:open-logs",
  copyDiagnostics: "breadboard:copy-diagnostics",
  quit: "breadboard:quit",
  pickFolder: "breadboard:pick-folder",
  openMicrophoneSettings: "breadboard:open-microphone-settings",
  allowThemeLocation: "breadboard:allow-theme-location",
  setTheme: "breadboard:set-theme",
  getStartupSound: "breadboard:get-startup-sound",
  setStartupSound: "breadboard:set-startup-sound",
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
  // The floating recording controller shown while a workflow is being taught by
  // demonstration. It has to stay visible over the application being
  // demonstrated, which only the shell can arrange.
  openTeachController: "breadboard:open-teach-controller",
  closeTeachController: "breadboard:close-teach-controller",
} as const;

/**
 * How the dashboard is choosing its theme, sent with every theme it applies.
 *
 * With "Sunrise to sunset" on, the dashboard follows the sun and the two
 * times are the local-clock minutes of that day's sunrise and sunset as it
 * computed them. They are what the shell needs to open the next launch on the
 * right side of the day before the dashboard has painted, without holding the
 * coordinates they were computed from. Sunrise moves by a minute or two a day,
 * so a launch weeks later may be off around the edges; the dashboard settles
 * the exact answer on its first paint.
 */
export type WindowThemeSchedule =
  | { mode: "manual" }
  | { mode: "sun"; sunriseMinutes: number; sunsetMinutes: number };
