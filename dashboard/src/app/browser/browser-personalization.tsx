"use client";

import { Check, ImageOff, LoaderCircle, PenLine, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { APP_THEME_CHANGE_EVENT } from "@/lib/app-theme";
import { browserDailyQuote, BROWSER_DAILY_QUOTES } from "./browser-daily-quotes";
import { BrowserSketchOutline } from "./browser-home-widgets";

export type BrowserWallpaperTheme = "light" | "dark";
export type BrowserWallpaperCategory = "Astral" | "Places" | "Abstract";

export interface BrowserWallpaper {
  id: string;
  name: string;
  category: BrowserWallpaperCategory;
  tone: BrowserWallpaperTheme;
  src: string;
  model: string;
}

interface PixabayWallpaper {
  id: number;
  name: string;
  creator: string;
  previewSrc: string;
  pageUrl: string;
}

interface PixabaySearchResponse {
  ok: boolean;
  images?: PixabayWallpaper[];
  error?: string;
}

export const BROWSER_WALLPAPERS: readonly BrowserWallpaper[] = [
  { id: "alpine-dawn", name: "Alpine dawn", category: "Places", tone: "light", src: "/browser-wallpapers/alpine-dawn.webp", model: "GPT Image" },
  { id: "limestone-courtyard", name: "Quiet courtyard", category: "Places", tone: "light", src: "/browser-wallpapers/limestone-courtyard.webp", model: "GPT Image" },
  { id: "mineral-clouds", name: "Mineral light", category: "Abstract", tone: "light", src: "/browser-wallpapers/mineral-clouds.webp", model: "GPT Image" },
  { id: "aurora-valley", name: "Aurora valley", category: "Astral", tone: "dark", src: "/browser-wallpapers/aurora-valley.webp", model: "GPT Image" },
  { id: "astral-nebula", name: "Astral quiet", category: "Astral", tone: "dark", src: "/browser-wallpapers/astral-nebula.webp", model: "GPT Image" },
  { id: "moonlit-coast", name: "Moonlit coast", category: "Places", tone: "dark", src: "/browser-wallpapers/moonlit-coast.webp", model: "GPT Image" },
] as const;

export const NO_WALLPAPER_ID = "none";

const DEFAULT_WALLPAPERS: Record<BrowserWallpaperTheme, string> = {
  light: NO_WALLPAPER_ID,
  dark: NO_WALLPAPER_ID,
};

const PIXABAY_CATEGORY_QUERIES: Record<"All" | BrowserWallpaperCategory, string> = {
  All: "inspirational nature landscape wallpaper",
  Astral: "stars galaxy night sky space",
  Places: "beautiful landscape travel place",
  Abstract: "abstract background texture",
};

function currentBrowserTheme(): BrowserWallpaperTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function wallpaperStorageKey(ownerKey: string, theme: BrowserWallpaperTheme): string {
  return `breadboard:browser-wallpaper:${ownerKey}:${theme}`;
}

function validWallpaperId(value: string | null): value is string {
  return Boolean(
    value && (
      value === NO_WALLPAPER_ID ||
      /^pixabay:\d{1,12}$/u.test(value) ||
      BROWSER_WALLPAPERS.some((wallpaper) => wallpaper.id === value)
    ),
  );
}

export function useBrowserWallpaper(ownerKey: string) {
  const [theme, setTheme] = useState<BrowserWallpaperTheme>("light");
  const [ready, setReady] = useState(false);
  const [selections, setSelections] = useState<Record<BrowserWallpaperTheme, string>>(
    DEFAULT_WALLPAPERS,
  );

  useEffect(() => {
    const readSelections = () => {
      const light = window.localStorage.getItem(wallpaperStorageKey(ownerKey, "light"));
      const dark = window.localStorage.getItem(wallpaperStorageKey(ownerKey, "dark"));
      setSelections({
        light: validWallpaperId(light) ? light : DEFAULT_WALLPAPERS.light,
        dark: validWallpaperId(dark) ? dark : DEFAULT_WALLPAPERS.dark,
      });
    };
    const syncTheme = () => setTheme(currentBrowserTheme());
    const frame = window.requestAnimationFrame(() => {
      readSelections();
      syncTheme();
      setReady(true);
    });

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const handleTheme = () => syncTheme();
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === wallpaperStorageKey(ownerKey, "light") ||
        event.key === wallpaperStorageKey(ownerKey, "dark")
      ) {
        readSelections();
      }
    };
    window.addEventListener(APP_THEME_CHANGE_EVENT, handleTheme);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener(APP_THEME_CHANGE_EVENT, handleTheme);
      window.removeEventListener("storage", handleStorage);
    };
  }, [ownerKey]);

  const select = (targetTheme: BrowserWallpaperTheme, wallpaperId: string) => {
    if (!validWallpaperId(wallpaperId)) return;
    setSelections((current) => ({ ...current, [targetTheme]: wallpaperId }));
    window.localStorage.setItem(wallpaperStorageKey(ownerKey, targetTheme), wallpaperId);
  };

  const selectedId = selections[theme];
  const pixabayId = selectedId.match(/^pixabay:(\d{1,12})$/u)?.[1];
  const wallpaper = selectedId === NO_WALLPAPER_ID
    ? null
    : BROWSER_WALLPAPERS.find((candidate) => candidate.id === selectedId) ?? (
      pixabayId
        ? {
            id: selectedId,
            name: "Pixabay photo",
            category: "Places" as const,
            tone: theme,
            src: `/api/browser-wallpapers/pixabay?id=${pixabayId}&image=1`,
          }
        : null
    );

  return { ready, theme, selections, wallpaper, hasWallpaper: Boolean(wallpaper), select };
}

export function BrowserDailyQuote({ ownerKey }: { ownerKey: string }) {
  const quoteRef = useRef<HTMLElement | null>(null);
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const now = new Date();
      setToday(now);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(schedule, tomorrow.getTime() - now.getTime() + 1_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const daily = useMemo(
    () => (today ? browserDailyQuote(today, ownerKey) : BROWSER_DAILY_QUOTES[0]!),
    [ownerKey, today],
  );
  const compactDaily = useMemo(
    () => (today ? browserDailyQuote(today, ownerKey, 42) : browserDailyQuote(new Date(0), ownerKey, 42)),
    [ownerKey, today],
  );

  return (
    <figure ref={quoteRef} className="browser-daily-quote" aria-label="Daily inspirational quote">
      <BrowserSketchOutline targetRef={quoteRef} index={2} />
      <blockquote className="browser-daily-quote-full">“{daily.quote}”</blockquote>
      <figcaption className="browser-daily-quote-full">— {daily.author}</figcaption>
      <blockquote className="browser-daily-quote-compact">“{compactDaily.quote}”</blockquote>
      <figcaption className="browser-daily-quote-compact">— {compactDaily.author}</figcaption>
    </figure>
  );
}

export function BrowserWallpaperPicker({
  currentTheme,
  selections,
  onSelect,
}: {
  currentTheme: BrowserWallpaperTheme;
  selections: Record<BrowserWallpaperTheme, string>;
  onSelect: (theme: BrowserWallpaperTheme, wallpaperId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<BrowserWallpaperTheme>(currentTheme);
  const [category, setCategory] = useState<"All" | BrowserWallpaperCategory>("All");
  const [source, setSource] = useState<"Generated" | "Human">("Generated");
  const [pixabayQuery, setPixabayQuery] = useState("");
  const [pixabayRequest, setPixabayRequest] = useState("");
  const [pixabayImages, setPixabayImages] = useState<PixabayWallpaper[]>([]);
  const [pixabayLoading, setPixabayLoading] = useState(false);
  const [pixabayError, setPixabayError] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    if (!open || source !== "Human" || !pixabayRequest) return;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      setPixabayLoading(true);
      setPixabayError("");
      try {
        const response = await fetch(
          `/api/browser-wallpapers/pixabay?q=${encodeURIComponent(pixabayRequest)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json() as PixabaySearchResponse;
        if (!response.ok || !payload.ok || !Array.isArray(payload.images)) {
          throw new Error(payload.error || "pixabay_unavailable");
        }
        if (live) setPixabayImages(payload.images);
      } catch (error) {
        if (live && !(error instanceof DOMException && error.name === "AbortError")) {
          setPixabayError("Pixabay could not load. Try again in a moment.");
        }
      } finally {
        if (live) setPixabayLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [open, pixabayRequest, source]);

  const visible = category === "All"
    ? BROWSER_WALLPAPERS
    : BROWSER_WALLPAPERS.filter((wallpaper) => wallpaper.category === category);

  const openPicker = () => {
    setEditingTheme(currentTheme);
    setOpen(true);
  };

  const chooseSource = (nextSource: "Generated" | "Human") => {
    setSource(nextSource);
    if (nextSource === "Human" && !pixabayRequest) {
      setPixabayRequest(PIXABAY_CATEGORY_QUERIES[category]);
    }
  };

  const chooseCategory = (nextCategory: "All" | BrowserWallpaperCategory) => {
    setCategory(nextCategory);
    if (source === "Human") {
      setPixabayQuery("");
      setPixabayRequest(PIXABAY_CATEGORY_QUERIES[nextCategory]);
    }
  };

  const searchPixabay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPixabayRequest(pixabayQuery.trim() || PIXABAY_CATEGORY_QUERIES[category]);
  };

  return (
    <>
      <button
        type="button"
        className="browser-wallpaper-trigger"
        aria-label="Choose browser background"
        aria-expanded={open}
        aria-controls="browser-wallpaper-drawer"
        title="Choose background"
        onClick={openPicker}
      >
        <PenLine aria-hidden="true" />
      </button>
      {open ? (
        <button
          type="button"
          className="browser-wallpaper-scrim"
          aria-label="Close background picker"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="browser-wallpaper-drawer"
        className="browser-wallpaper-drawer"
        data-open={open}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        aria-label="Browser backgrounds"
      >
        <header>
          <strong>Backgrounds</strong>
          <button type="button" aria-label="Close background picker" onClick={() => setOpen(false)}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="browser-wallpaper-theme-tabs" role="tablist" aria-label="Background theme">
          {(["light", "dark"] as const).map((targetTheme) => (
            <button
              key={targetTheme}
              type="button"
              role="tab"
              aria-selected={editingTheme === targetTheme}
              onClick={() => setEditingTheme(targetTheme)}
            >
              <span aria-hidden="true">{targetTheme === "light" ? "☼" : "☾"}</span>
              {targetTheme === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <p>Choose the image Breadboard uses whenever {editingTheme} mode is active.</p>
        <button
          type="button"
          className="browser-wallpaper-none"
          aria-pressed={selections[editingTheme] === NO_WALLPAPER_ID}
          onClick={() => onSelect(editingTheme, NO_WALLPAPER_ID)}
        >
          <span className="browser-wallpaper-none-preview" aria-hidden="true">
            <ImageOff />
            {selections[editingTheme] === NO_WALLPAPER_ID
              ? <span className="browser-wallpaper-check"><Check /></span>
              : null}
          </span>
          <span><strong>No image</strong><small>Use the Breadboard theme</small></span>
        </button>
        <div className="browser-wallpaper-source-tabs" role="tablist" aria-label="Background source">
          {(["Generated", "Human"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={source === value}
              onClick={() => chooseSource(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="browser-wallpaper-categories" aria-label="Background categories">
          {(["All", "Astral", "Places", "Abstract"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => chooseCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {source === "Human" ? (
          <form className="browser-wallpaper-search" onSubmit={searchPixabay}>
            <Search aria-hidden="true" />
            <input
              value={pixabayQuery}
              onChange={(event) => setPixabayQuery(event.target.value)}
              placeholder="Search Pixabay"
              aria-label="Search Pixabay backgrounds"
              maxLength={100}
            />
            <button type="submit">Search</button>
          </form>
        ) : null}
        <div className="browser-wallpaper-grid">
          {source === "Generated" ? visible.map((wallpaper) => {
            const selected = selections[editingTheme] === wallpaper.id;
            return (
              <button
                key={wallpaper.id}
                type="button"
                className="browser-wallpaper-option"
                aria-pressed={selected}
                aria-label={`${wallpaper.name}, ${wallpaper.category}`}
                onClick={() => onSelect(editingTheme, wallpaper.id)}
              >
                <span
                  className="browser-wallpaper-thumbnail"
                  style={{ backgroundImage: `url("${wallpaper.src}")` } as CSSProperties}
                >
                  {selected ? <span className="browser-wallpaper-check"><Check aria-hidden="true" /></span> : null}
                </span>
                <span><strong>{wallpaper.name}</strong><small>Generated by {wallpaper.model}</small></span>
              </button>
            );
          }) : null}
          {source === "Human" && pixabayLoading ? (
            <p className="browser-wallpaper-status"><LoaderCircle className="is-spinning" aria-hidden="true" />Finding photos…</p>
          ) : null}
          {source === "Human" && pixabayError ? (
            <p className="browser-wallpaper-status is-error">{pixabayError}</p>
          ) : null}
          {source === "Human" && !pixabayLoading && !pixabayError ? pixabayImages.map((image) => {
            const wallpaperId = `pixabay:${image.id}`;
            const selected = selections[editingTheme] === wallpaperId;
            return (
              <button
                key={image.id}
                type="button"
                className="browser-wallpaper-option"
                aria-pressed={selected}
                aria-label={`${image.name}, photo by ${image.creator} on Pixabay`}
                onClick={() => onSelect(editingTheme, wallpaperId)}
              >
                <span
                  className="browser-wallpaper-thumbnail"
                  style={{ backgroundImage: `url("${image.previewSrc}")` } as CSSProperties}
                >
                  {selected ? <span className="browser-wallpaper-check"><Check aria-hidden="true" /></span> : null}
                </span>
                <span><strong>{image.name}</strong><small>Photo by {image.creator}</small></span>
              </button>
            );
          }) : null}
        </div>
        {source === "Human" ? (
          <a className="browser-wallpaper-attribution" href="https://pixabay.com/" target="_blank" rel="noreferrer">
            Photos from Pixabay
          </a>
        ) : null}
      </aside>
    </>
  );
}
