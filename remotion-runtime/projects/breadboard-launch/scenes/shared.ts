import { loadFont as loadSans } from "@remotion/google-fonts/SourceSans3";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";

// The app's own typefaces: Source Sans 3 for everything, IBM Plex Mono for code.
export const sans = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["500"], subsets: ["latin"] }).fontFamily;

// The app's light theme, from dashboard/src/app/globals.css.
export const bg = "#E6F0E6";
export const surface = "#FAF7EF";
export const raised = "#FFFEFB";
export const paper = "#ECE3D2";
export const ink = "#13201B";
export const muted = "#50615A";
export const line = "#BCCFC2";
export const lineStrong = "#9CB7A7";
export const botanical = "#4F6F68";
export const live = "#2F9E5A";
export const leaf = "#7FE6A4";
export const marker = "#F4E7AD";
export const link = "#1D4ED8";

// The song in video time (track time minus 85.9 s): a silence, five build
// hits, the drop, a new phrase every eight beats, three drum rolls, the stop,
// then a quiet tail the picture fades out over.
export const BEAT = 0.4446;
export const BUILD = [0.95, 1.45, 1.92, 2.79, 2.94];
export const DROP = 3.2;
export const PHRASES = [DROP, 6.76, 10.33, 13.88, 17.44, 20.99, 24.54, 28.11];
export const ROLL_A = [8.11, 8.33, 8.55, 8.78];
export const ROLL_B = [22.33, 22.56, 22.77, 23.0];
export const ROLL_C = [29.67, 29.89, 30.11];
export const FINAL = 31.66;
export const STOP = 32.24;
export const END = 36;

export type Clock = {
  /** Seconds since this shot began. */
  t: number;
  /** Seconds since the video began. */
  time: number;
};
