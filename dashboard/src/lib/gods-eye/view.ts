// The one structured fact a God's Eye run produces: where the globe is
// pointed, which live layers are active, and in which sensor style.
//
// The clone already knows how to restore a whole scene from its URL hash
// (src/sharelink.js in gods-eye-view): `#lat=…&lon=…&alt=…&heading=…&pitch=…
// &style=…&hud=…&hv=1&map=photoreal`. A view here is the subset of that state a
// run decides, validated hard because it crosses two boundaries — a model
// writes it, and a URL carries it. `tests/gods-eye-agent.test.mjs` reads the
// clone's sharelink parser and asserts these parameter names still exist.
//
// Client-safe: imported by the run card as well as the run manager.

/** The clone's URL-facing sensor styles (`STYLE_TO_URL` in sharelink.js). */
export const GODS_EYE_STYLES = [
  "normal",
  "crt",
  "nvg",
  "flir",
  "anime",
  "noir",
  "snow",
] as const;
export type GodsEyeStyle = (typeof GODS_EYE_STYLES)[number];

/** Live layers the agent may ask the clone to restore from a share link. */
export const GODS_EYE_LAYERS = [
  "ais-live-vessels",
  "cctv",
  "earthquakes",
  "flights",
  "local-firms",
  "military",
  "satellites",
  "traffic",
] as const;
export type GodsEyeLayer = (typeof GODS_EYE_LAYERS)[number];

/** Compact tokens owned by `LAYER_STATE_REGISTRY` in the clone. */
const GODS_EYE_LAYER_TOKENS: Record<GodsEyeLayer, string> = {
  "ais-live-vessels": "a",
  cctv: "c",
  earthquakes: "e",
  flights: "f",
  "local-firms": "w",
  military: "m",
  satellites: "s",
  traffic: "t",
};

export interface GodsEyeView {
  /** What the view is of, in a few words — the widget's readout label. */
  label: string;
  lat: number;
  lon: number;
  /** Camera altitude in meters, the clone's `alt`. */
  altM: number;
  headingDeg: number;
  /** Camera pitch; -90 is straight down, the clone defaults to -35. */
  pitchDeg: number;
  style: GodsEyeStyle;
  /** Canonically ordered layer ids understood by the clone's v2 share codec. */
  layers: GodsEyeLayer[];
}

const MIN_ALT_M = 120;
const MAX_ALT_M = 20_000_000;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function normalizeLayers(raw: unknown): GodsEyeLayer[] {
  const requested = new Set(Array.isArray(raw) ? raw.map(String) : []);
  return GODS_EYE_LAYERS.filter((layer) => requested.has(layer));
}

/**
 * Recover the useful live layer for old saved views and imperfect model
 * answers. The model still returns explicit ids; this is the deterministic
 * safety net that makes requests such as "aircraft over the Netherlands" do
 * more than move the camera.
 */
export function inferGodsEyeLayers(text: string): GodsEyeLayer[] {
  const value = text.toLowerCase();
  const requested = new Set<GodsEyeLayer>();
  const add = (layer: GodsEyeLayer, pattern: RegExp) => {
    if (pattern.test(value)) requested.add(layer);
  };

  add("flights", /\b(aircraft|airplanes?|aeroplanes?|planes?|flights?|airliners?|aviation|airports?|air\s+traffic)\b/);
  add("military", /\b(military\s+(?:aircraft|aviation|flights?)|fighter\s*jets?|warplanes?)\b/);
  add("ais-live-vessels", /\b(ships?|vessels?|boats?|maritime|marine\s+traffic|ais)\b/);
  add("satellites", /\b(satellites?|orbital|orbiting|spacecraft|iss)\b/);
  add("earthquakes", /\b(earthquakes?|quakes?|seismic|tremors?)\b/);
  add("local-firms", /\b(wildfires?|forest\s+fires?|fire\s+hotspots?|active\s+fires?|nasa\s+firms)\b/);
  add("cctv", /\b(cctv|public\s+cameras?|traffic\s+cameras?|webcams?)\b/);
  add("traffic", /\b(road\s+traffic|traffic\s+jams?|congestion|road\s+vehicles?|cars?)\b/);

  return GODS_EYE_LAYERS.filter((layer) => requested.has(layer));
}

/**
 * A view from untrusted parts — a model's answer, a URL's query — or null.
 * Everything is clamped rather than rejected where a clamp keeps the intent:
 * a camera 2° below the horizon is a usable view, coordinates off the planet
 * are not.
 */
export function normalizeGodsEyeView(raw: unknown): GodsEyeView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const lat = finite(record.lat);
  const lon = finite(record.lon);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const style = (GODS_EYE_STYLES as readonly string[]).includes(String(record.style))
    ? (String(record.style) as GodsEyeStyle)
    : "normal";
  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim().slice(0, 120)
      : "the selected area";
  const layers = Object.hasOwn(record, "layers")
    ? normalizeLayers(record.layers)
    : inferGodsEyeLayers(label);
  return {
    label,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    altM: Math.round(clamp(finite(record.altM) ?? 1_200, MIN_ALT_M, MAX_ALT_M)),
    headingDeg: Number((((finite(record.headingDeg) ?? 0) % 360 + 360) % 360).toFixed(1)),
    pitchDeg: Number(clamp(finite(record.pitchDeg) ?? -35, -90, -5).toFixed(1)),
    style,
    layers,
  };
}

/**
 * The clone's share-link hash for a view. HUD on, in its tactical variant, on
 * the photoreal map stack — the "forbidden cockpit" look the widget frames.
 */
export function godsEyeShareHash(view: GodsEyeView): string {
  const layers = normalizeLayers(view.layers ?? inferGodsEyeLayers(view.label));
  const params = new URLSearchParams({
    lat: String(view.lat),
    lon: String(view.lon),
    alt: String(view.altM),
    heading: String(view.headingDeg),
    pitch: String(view.pitchDeg),
    style: view.style,
    hud: "tactical",
    hv: "1",
    map: "photoreal",
    // The clone ignores layer state unless both of these v2 fields exist.
    v: "2",
    l: layers.map((layer) => GODS_EYE_LAYER_TOKENS[layer]).join("."),
  });
  // v2 links predate the clone's current default-on 3D aircraft setting, so
  // encode that option explicitly when an aircraft feed is requested.
  if (layers.includes("flights") || layers.includes("military")) {
    params.set("lo", "f.e.1");
  }
  return params.toString();
}

/**
 * Where a saved view opens. The path is Breadboard's, not the clone's: the
 * globe server's port is chosen when it starts, so a link straight to it would
 * die with the next restart, while this route starts or finds the server and
 * redirects into it with the hash rebuilt from these validated parameters.
 *
 * `theme` asks the route to dress the cockpit in Breadboard's own palette in
 * that scheme (the clone's breadboard-theme.css); without it the globe wears
 * its stock cyan-on-black look.
 */
export function godsEyeOpenPath(view: GodsEyeView, theme?: "light" | "dark"): string {
  const layers = normalizeLayers(view.layers ?? inferGodsEyeLayers(view.label));
  const params = new URLSearchParams({
    lat: String(view.lat),
    lon: String(view.lon),
    alt: String(view.altM),
    heading: String(view.headingDeg),
    pitch: String(view.pitchDeg),
    style: view.style,
    label: view.label,
  });
  for (const layer of layers) params.append("layer", layer);
  if (theme) params.set("theme", theme);
  return `/api/gods-eye/open?${params.toString()}`;
}

const MARKER = "GODS_EYE_VIEW:";
const COMMENT_MARKER = new RegExp(`<!--\\s*${MARKER}\\s*([\\s\\S]*?)\\s*-->`, "g");
const BARE_MARKER = new RegExp(`^[\\t ]*${MARKER}([^\\r\\n]*)$`, "gm");
const GODS_EYE_OPEN_LINK =
  /^[\t ]*\[Open the live(?: aircraft)? view\]\([^\r\n)]*\/api\/gods-eye\/open\?[^\r\n)]*\)[\t ]*$/gim;

/** Carry the view with the saved summary, invisibly to Markdown. */
export function attachGodsEyeView(content: string, view: GodsEyeView): string {
  const marker = `<!--${MARKER}${encodeURIComponent(JSON.stringify(view))}-->`;
  return `${marker}\n${content.trim()}`;
}

/**
 * A saved summary back into prose plus its view. The card renders the prose
 * and frames the view; a summary that reaches any other renderer shows only
 * the prose, because the marker is an HTML comment.
 */
export function parseGodsEyeResult(content: string): {
  content: string;
  view: GodsEyeView | null;
} {
  let view: GodsEyeView | null = null;
  let hasPrivateMarker = false;
  const collect = (payload: string) => {
    const raw = payload.trim();
    const candidates = [raw];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded);
    } catch {
      // A damaged marker is still private metadata and must not reach Markdown.
    }
    for (const candidate of candidates) {
      try {
        const normalized = normalizeGodsEyeView(JSON.parse(candidate));
        if (normalized) {
          view = view ?? normalized;
          break;
        }
      } catch {
        // Try the decoded form next. The answer surrounding this marker stays.
      }
    }
  };
  let clean = content.replace(COMMENT_MARKER, (_marker, payload: string) => {
    hasPrivateMarker = true;
    collect(payload);
    return "";
  });
  // A model handoff may discard the HTML comment delimiters while preserving
  // the private marker line. Do not let that legacy form become visible prose.
  clean = clean.replace(BARE_MARKER, (_marker, payload: string) => {
    hasPrivateMarker = true;
    collect(payload);
    return "";
  });
  // Older saved results included a second way to open the same view. The
  // embedded viewport is now the only interaction, so hide that legacy link
  // whenever this is recognisably a God's Eye result. This also covers links
  // rewritten to an absolute localhost URL by an earlier handoff.
  if (hasPrivateMarker) clean = clean.replace(GODS_EYE_OPEN_LINK, "");
  return { content: clean.trim(), view };
}
