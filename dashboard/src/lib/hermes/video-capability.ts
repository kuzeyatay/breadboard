// Breadboard's one Video capability. `/agents:video <brief>` is the only video entry the
// capability picker shows; it sends the brief to whichever engine fits, as that engine's own
// command, so every engine's launcher, run card and artifact flow stay exactly as they were.
// Every engine ends in a video artifact, and every video artifact opens in Video Studio.

export const VIDEO_CAPABILITY_COMMAND = "/agents:video";

interface Engine { command: string; test?: RegExp }

// First match wins; the order runs from the most specific request to the default.
const ENGINES: Engine[] = [
  { command: "/agents:shorts", test: /\b(?:shorts?|reels?|tiktoks?|clips?)\b[^.]*\b(?:from|out of|of)\b[^.]*\b(?:video|podcast|interview|stream|youtube|link)\b|\brepurpose\b|\bviral (?:clips?|moments?)\b/i },
  { command: "/agents:money-printer", test: /\bstock footage\b|\bfaceless\b|\b(?:pexels|pixabay)\b/i },
  { command: "/agents:vimax", test: /\b(?:screenplay|storyboard|short film|characters?|story ?line|film about a|animated story)\b/i },
  { command: "/agents:vox-director", test: /\b(?:vox|collage|paper[- ]cut|narrated explainer)\b/i },
  { command: "/agents:openmontage", test: /\b(?:documentary|production pipeline|full production|trailer)\b/i },
  { command: "/agents:hyperframes", test: /\b(?:hyperframes|html|web page|website)\b[^.]*\b(?:video|animation|promo)\b/i },
  { command: "/film", test: /\b(?:3d|three\.?js|cinematic|particles?|shaders?|camera fly|volumetric)\b/i },
  { command: "/video" },
];

const EDIT = /\b(?:edit|cut|trim|shorten|speed up|slow down|crop|reframe|vertical|subtitle|caption|color ?grade|grade|remove (?:the )?(?:silence|ums?|pauses)|tighten|mute)\b/i;

/** The command text the brief goes out as, or null when this is not a `/agents:video` message. */
export function videoCapabilityRoute(text: string, options: { hasVideo?: boolean } = {}): string | null {
  const match = /^\/agents:video(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const brief = (match[1] ?? "").trim();
  if (!brief) return null;
  // A video the person brought plus an edit verb is an edit of that video: sent as plain
  // text, the chat's own edit path (Video Use, then Video Studio for hands-on work) takes it.
  if (options.hasVideo && EDIT.test(brief)) return brief;
  const engine = ENGINES.find(candidate => !candidate.test || candidate.test.test(brief))!;
  return `${engine.command} ${brief}`;
}

/** The engines folded into this capability, so the picker can hide their own entries. */
export const VIDEO_ENGINE_COMMANDS = ENGINES.map(engine => engine.command);
