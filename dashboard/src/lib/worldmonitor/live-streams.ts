// Ported from the worldmonitor clone (github.com/koala73/worldmonitor, AGPL-3.0)
// — the channel list in `src/components/LiveNewsPanel.ts` and the webcam list in
// `src/components/LiveWebcamsPanel.ts`.
//
// Both are 24/7 YouTube live streams, so they embed directly and need no key,
// no proxy and no player library. Upstream additionally resolves the CURRENT
// live video id per channel through its own API (ids rotate when a broadcaster
// restarts a stream); without that service this port uses the same fallback ids
// upstream ships, and every tile carries a link out to the channel so a stale
// id is one click from the live page rather than a dead end.

export interface LiveChannel {
  id: string;
  name: string;
  /** YouTube handle — the channel page, and where to look when an id rotates. */
  handle: string;
  videoId: string;
}

/**
 * Upstream's full-variant channel set, in its order, with the ids refreshed to
 * what each channel was streaming when this was written. They are the first
 * paint only — `youtube-live.ts` resolves the current one per channel.
 */
export const LIVE_CHANNELS: LiveChannel[] = [
  { id: "aljazeera", name: "Al Jazeera", handle: "@AlJazeeraEnglish", videoId: "gCNeDWCI0vo" },
  { id: "sky", name: "Sky News", handle: "@SkyNews", videoId: "YDvsBbKfLPA" },
  { id: "bloomberg", name: "Bloomberg", handle: "@markets", videoId: "QB5BNdBFujE" },
  { id: "euronews", name: "Euronews", handle: "@euronews", videoId: "pykpO5kQJ98" },
  { id: "dw", name: "DW", handle: "@DWNews", videoId: "LuKwFajn37U" },
  { id: "cnbc", name: "CNBC", handle: "@CNBC", videoId: "9NyxcX3rhQs" },
  { id: "cnn", name: "CNN", handle: "@CNN", videoId: "GotlA1KKWoo" },
  { id: "france24", name: "France 24", handle: "@FRANCE24", videoId: "a47ckXKZjxI" },
  { id: "alarabiya", name: "Al Arabiya", handle: "@AlArabiya", videoId: "n7eQejkXbnM" },
];

export type WebcamRegion = "middle-east" | "europe" | "americas" | "asia" | "space";

export interface WebcamFeed {
  id: string;
  city: string;
  country: string;
  region: WebcamRegion;
  handle: string;
  videoId: string;
}

/**
 * The webcam set, in upstream's shape and region order — conflict-adjacent
 * first. Seven of upstream's channels have since gone dark (its list was
 * validated in Feb 2026 and never revisited), and a permanently off-air tile is
 * worse than no tile, so those are replaced with channels checked live at the
 * time of writing. Ids here are the first paint; the current one is resolved.
 */
export const WEBCAM_FEEDS: WebcamFeed[] = [
  { id: "jerusalem", city: "Jerusalem", country: "Israel", region: "middle-east", handle: "@TheWesternWall", videoId: "W8Xqepd4DvE" },
  { id: "mecca", city: "Mecca", country: "Saudi Arabia", region: "middle-east", handle: "@MakkahLive", videoId: "u_n9a_sWL_M" },
  { id: "beirut-mtv", city: "Beirut", country: "Lebanon", region: "middle-east", handle: "@MTVLebanonNews", videoId: "PZj81tguBk4" },
  { id: "israel-jpost", city: "Jerusalem", country: "JPost", region: "middle-east", handle: "@JerusalemPost", videoId: "AUk0Ym-dCEE" },
  { id: "london", city: "London", country: "UK", region: "europe", handle: "@AbbeyRoadStudios", videoId: "xaiLzXngTaY" },
  { id: "ukraine-espreso", city: "Ukraine", country: "Espreso", region: "europe", handle: "@espresotv", videoId: "eDU5dozVceE" },
  { id: "europe-cams", city: "Europe", country: "City cams", region: "europe", handle: "@SkylineWebcams", videoId: "kUfuwa8mDrA" },
  { id: "earthtv", city: "Cities", country: "earthTV", region: "europe", handle: "@EarthTV", videoId: "5p_KGD4fJZs" },
  { id: "washington", city: "Washington DC", country: "USA", region: "americas", handle: "@AxisCommunications", videoId: "cNk-CnfTQFM" },
  { id: "new-york", city: "New York", country: "USA", region: "americas", handle: "@EarthCam", videoId: "H4LAPceXTfQ" },
  { id: "mexico", city: "Mexico", country: "Mexico", region: "americas", handle: "@webcamsdemexico", videoId: "EJhJdEZZ020" },
  { id: "taipei", city: "Taipei", country: "Taiwan", region: "asia", handle: "@JackyWuTaipei", videoId: "pmM2CeSAx0I" },
  { id: "tokyo", city: "Tokyo", country: "Japan", region: "asia", handle: "@ANNnewsCH", videoId: "3IEOaN9CeFg" },
  { id: "japan-tbs", city: "Japan", country: "TBS", region: "asia", handle: "@tbsnewsdig", videoId: "eA-LxCNixRw" },
  { id: "singapore", city: "Singapore", country: "CNA", region: "asia", handle: "@ChannelNewsAsia", videoId: "XWq5kBlakcQ" },
  { id: "sydney", city: "Sydney", country: "Australia", region: "asia", handle: "@WebcamSydney", videoId: "5uZa3-RMFos" },
  { id: "iss-earth", city: "ISS Earth View", country: "NASA", region: "space", handle: "@NASA", videoId: "M3HKLzjvKPc" },
  { id: "space-x", city: "SpaceX", country: "Space", region: "space", handle: "@SpaceX", videoId: "Iz6qdzVCN9g" },
];

export const WEBCAM_REGIONS: Array<{ id: WebcamRegion | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "middle-east", label: "Mideast" },
  { id: "europe", label: "Europe" },
  { id: "americas", label: "Americas" },
  { id: "asia", label: "Asia" },
  { id: "space", label: "Space" },
];

/**
 * Muted autoplay with chrome stripped back — the same parameters upstream uses.
 * Muted is not a preference: an unmuted autoplay is blocked by every browser,
 * and four tiles talking at once would be unusable anyway.
 */
export function embedUrl(videoId: string, options: { controls?: boolean } = {}): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: options.controls === false ? "0" : "1",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
  });
  // `origin` is what upstream sends and what several broadcasters' embeds check
  // before they will play; without a real page origin YouTube answers with its
  // "video player configuration error" instead of the stream.
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    params.set("origin", window.location.origin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

export function channelUrl(handle: string): string {
  return `https://www.youtube.com/${handle}/live`;
}
