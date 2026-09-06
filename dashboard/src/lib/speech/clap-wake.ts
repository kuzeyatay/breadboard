// Compatibility for microphone menus and existing dock registrations.
import { foregroundAudioActive, holdForegroundAudio } from './clap/audio-focus';
import { clapSnapshot, pauseClapControls, saveClapPreferences } from './clap/client';
import { registerClapDock } from './clap/targets';
export const CLAP_SETTINGS_EVENT = 'breadboard:clap-settings';
export const CLAP_ACTIVITY_EVENT = 'breadboard:audio-focus';
export const CLAP_STATUS_EVENT = 'breadboard:clap-status';
export const clapWakeEnabled = () => clapSnapshot().active;
export const clapWakeIssue = () => clapSnapshot().issue;
export const microphoneInUse = foregroundAudioActive;
export const holdClapWake = holdForegroundAudio;
export const registerClapChat = registerClapDock;
export function setClapWakeEnabled(enabled: boolean) {
  if (!enabled) pauseClapControls();
  else void saveClapPreferences({ ...clapSnapshot().preferences, enabled: true }, true);
}
