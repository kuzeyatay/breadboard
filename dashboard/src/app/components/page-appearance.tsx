"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ImageOff, LoaderCircle, Music2, Palette, Pencil, Search, Shuffle, Trash2, Upload, X } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { asciiWallpaperSlug } from "@/lib/ascii-wallpapers";
import { prepareAsciiWallpaper } from "@/lib/ascii-magic-client";
import { applyAppTheme } from "@/lib/app-theme";
import { prepareWallpaperUpload, WALLPAPER_UPLOAD_ACCEPT } from "@/lib/wallpaper-upload";
import {
  WALLPAPERS,
  NO_WALLPAPER_ID,
  ambientBackgroundId,
  ambientBackgroundOptions,
  resolveWallpaper,
  type AppearancePage,
  type AppearanceTheme,
  type WallpaperCategory,
} from "@/lib/page-appearance";
import { usePageAppearance } from "./use-page-appearance";
import SpotifyAmbientBackground from "./spotify-ambient-background";
import RainAppearanceChoice from "./rain-appearance-choice";
import { useSpotifyAmbientSource } from "./spotify-ambient-context";
import styles from "./page-appearance.module.css";
import panelStyles from "./utility-panel.module.css";

const AsciiWallpaperGallery = lazy(() => import("./ascii-wallpaper-gallery"));
type BackgroundSource = "Generated" | "Human" | "ASCII";

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
const PIXABAY_CATEGORY_QUERIES: Record<"All" | WallpaperCategory, string> = {
  All: "inspirational nature landscape wallpaper",
  Astral: "stars galaxy night sky space",
  Places: "beautiful landscape travel place",
  Abstract: "abstract background texture",
};

const warmPreviews = new Map<string, HTMLImageElement>();
function warmWallpaperPreviews() {
  for (const wallpaper of WALLPAPERS) {
    if (warmPreviews.has(wallpaper.previewSrc)) continue;
    const image = new Image();
    image.fetchPriority = "low";
    image.decoding = "async";
    image.onerror = () => warmPreviews.delete(wallpaper.previewSrc);
    image.src = wallpaper.previewSrc;
    warmPreviews.set(wallpaper.previewSrc, image);
  }
}
// Public photo searches are cached by query, never mixed with user preferences.
const photoSearchCache = new Map<string, { images: PixabayWallpaper[]; expires: number }>();

export default function PageAppearance({ page, ownerKey, initialOpen = false, triggerIcon = "pencil", placement = "page" }: { page: AppearancePage; ownerKey: string; initialOpen?: boolean; triggerIcon?: "pencil" | "palette"; placement?: "page" | "terminal" }) {
  const [open, setOpen] = useState(initialOpen);
  const TriggerIcon = triggerIcon === "palette" ? Palette : Pencil;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className={styles.anchor} data-page={page} data-placement={placement}>
        <Dialog.Trigger asChild>
          <button type="button" className={styles.customizeButton} onPointerEnter={warmWallpaperPreviews} onFocus={warmWallpaperPreviews} onPointerDown={warmWallpaperPreviews} aria-label="Customize appearance" title="Customize appearance">
            <TriggerIcon size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className={panelStyles.scrim} />
        <Dialog.Content className={panelStyles.panel} data-appearance-panel>
          <header className={panelStyles.header}>
            <Dialog.Title className={panelStyles.heading}>Appearance</Dialog.Title>
            <Dialog.Close className={panelStyles.iconButton} aria-label="Close appearance"><X size={20} strokeWidth={1.7} aria-hidden="true" /></Dialog.Close>
          </header>
          <Dialog.Description className={panelStyles.description}>Your theme and backgrounds, saved automatically.</Dialog.Description>
          {open && <AppearanceChoices initialPage={page} ownerKey={ownerKey} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppearanceChoices({ initialPage, ownerKey }: { initialPage: AppearancePage; ownerKey: string }) {
  const appearance = usePageAppearance(ownerKey, initialPage);
  const spotifySource = useSpotifyAmbientSource();
  const [editingTheme, setEditingTheme] = useState<AppearanceTheme>(appearance.theme);
  const [saveError, setSaveError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadHintId = useId();
  const randomLabelId = useId();
  const randomHintId = useId();
  const uploadRequest = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [category, setCategory] = useState<"All" | WallpaperCategory>("All");
  const [source, setSource] = useState<BackgroundSource>(() => initialPage === "new-tab" && asciiWallpaperSlug(appearance.preference.backgrounds[appearance.theme]) ? "ASCII" : "Generated");
  const [pixabayQuery, setPixabayQuery] = useState("");
  const [pixabayRequest, setPixabayRequest] = useState("");
  const [pixabayImages, setPixabayImages] = useState<PixabayWallpaper[]>([]);
  const [pixabayLoading, setPixabayLoading] = useState(false);
  const [pixabayError, setPixabayError] = useState("");
  const [pixabayRetry, setPixabayRetry] = useState(0);
  const [loadingBackground, setLoadingBackground] = useState<string | null>(null);

  useEffect(() => () => { uploadRequest.current += 1; }, []);

  function cancelUpload() {
    uploadRequest.current += 1;
    setUploading(false);
    setLoadingBackground(null);
  }

  useEffect(() => {
    if (source !== "Human" || !pixabayRequest) return;
    const cached = photoSearchCache.get(pixabayRequest);
    if (cached && cached.expires > Date.now()) {
      setPixabayImages(cached.images);
      setPixabayError("");
      setPixabayLoading(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    void (async () => {
      setPixabayLoading(true);
      setPixabayError("");
      try {
        const response = await fetch(
          `/api/browser-wallpapers/pixabay?q=${encodeURIComponent(pixabayRequest)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) },
        );
        const payload = await response.json() as PixabaySearchResponse;
        if (!response.ok || !payload.ok || !Array.isArray(payload.images)) {
          throw new Error(payload.error || "pixabay_unavailable");
        }
        photoSearchCache.delete(pixabayRequest);
        photoSearchCache.set(pixabayRequest, {images: payload.images, expires: Date.now() + 10 * 60_000});
        if (photoSearchCache.size > 12) photoSearchCache.delete(photoSearchCache.keys().next().value!);
        if (live) setPixabayImages(payload.images);
      } catch (error) {
        if (live && !(error instanceof DOMException && error.name === "AbortError")) {
          setPixabayError("could not load. Try again in a moment.");
        }
      } finally {
        if (live) setPixabayLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [pixabayRequest, source, pixabayRetry]);

  const visible = category === "All"
    ? WALLPAPERS
    : WALLPAPERS.filter((wallpaper) => wallpaper.category === category);

  const chooseSource = (nextSource: BackgroundSource) => {
    setSource(nextSource);
    if (nextSource === "Human" && !pixabayRequest) {
      setPixabayRequest(PIXABAY_CATEGORY_QUERIES[category]);
    }
  };

  const chooseCategory = (nextCategory: "All" | WallpaperCategory) => {
    setCategory(nextCategory);
    if (source === "Human") {
      setPixabayQuery("");
      setPixabayRequest(PIXABAY_CATEGORY_QUERIES[nextCategory]);
    }
  };

  const searchPixabay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPixabayRetry(value => value + 1);
    setPixabayRequest(pixabayQuery.trim() || PIXABAY_CATEGORY_QUERIES[category]);
  };

  function selectTheme(theme: AppearanceTheme) {
    cancelUpload();
    try {
      applyAppTheme(theme);
      setEditingTheme(theme);
      setSaveError("");
    } catch {
      setSaveError("Couldn’t save your choice. Check that browser storage is available.");
    }
  }

  async function saveAppearance(patch: Parameters<typeof appearance.save>[0]) {
    cancelUpload();
    const request = uploadRequest.current;
    setSaveError("");
    try {
      await appearance.save(patch);
    } catch (error) {
      if (request === uploadRequest.current) {
        setSaveError(error instanceof Error ? error.message : "Couldn’t save the background. Try again.");
      }
    }
  }

  async function selectBackground(theme: AppearanceTheme, value: string) {
    cancelUpload();
    const request = uploadRequest.current;
    setSaveError("");
    setLoadingBackground(value);
    try {
      const ascii = asciiWallpaperSlug(value);
      if (ascii) await prepareAsciiWallpaper(ascii);
      const wallpaper = resolveWallpaper(value, theme);
      if (wallpaper) {
        // CSS backgrounds fail silently and are fetched at low priority. Decode
        // the selected image first so a slow/broken request cannot blank home.
        const image = new Image();
        image.fetchPriority = "high";
        image.src = wallpaper.src;
        await image.decode();
      }
      if (request !== uploadRequest.current) return;
      await appearance.save({ background: { theme, value } });
    } catch (error) {
      if (request === uploadRequest.current) {
        setSaveError(error instanceof DOMException && error.name === "EncodingError"
          ? "Couldn’t load that image. Select it again to retry. Your current background is unchanged."
          : error instanceof Error ? error.message : "Couldn’t load the background. Try again.");
      }
    } finally {
      if (request === uploadRequest.current) setLoadingBackground(null);
    }
  }

  function toggleRandomBackground() {
    void saveAppearance({ random: { theme: editingTheme, enabled: !appearance.preference.random?.[editingTheme] } });
  }

  async function uploadFile(file: File) {
    const request = ++uploadRequest.current;
    setUploading(true);
    setSaveError("");
    try {
      const image = await prepareWallpaperUpload(file);
      if (request !== uploadRequest.current) return;
      selectBackground(editingTheme, image);
    } catch (error) {
      if (request === uploadRequest.current) {
        setSaveError(error instanceof Error ? error.message : "Couldn’t read that image. Try another file.");
      }
    } finally {
      if (request === uploadRequest.current) setUploading(false);
    }
  }

  function uploadBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadFile(file);
  }

  const uploadedImage = appearance.preference.backgrounds[editingTheme].startsWith("data:image/")
    ? appearance.preference.backgrounds[editingTheme] : null;
  const uploadLabel = uploading ? "Preparing image…" : uploadedImage ? "Replace image" : "Upload your own image";
  const ambient = ambientBackgroundOptions(appearance.preference.backgrounds[editingTheme]);
  const toggleAmbient = (option: "spotify" | "random") => {
    void selectBackground(editingTheme, ambientBackgroundId({ ...ambient, [option]: !ambient[option] }));
  };

  return (
    <div className={`${panelStyles.scrollArea} ${styles.choices}`}>
      <div className={styles.appTheme}>
        <h3 className={styles.label}>Theme</h3>
        <div className={`${styles.pageTabs} ${styles.themeTabs}`} role="group" aria-label="App theme">
          {(["light", "dark"] as const).map((theme) => (
            <button key={theme} type="button" aria-pressed={appearance.theme === theme} onClick={() => selectTheme(theme)}>{theme === "light" ? "Light" : "Dark"}</button>
          ))}
        </div>
        <p className={styles.hint}>Applies everywhere in Breadboard.</p>
      </div>
      <h3 className={styles.label}>Background</h3>
      <div className="browser-wallpaper-theme-tabs" role="group" aria-label="Background for">
        {(["light", "dark"] as const).map((targetTheme) => (
          <button
            key={targetTheme}
            type="button"
            aria-pressed={editingTheme === targetTheme}
            onClick={() => { cancelUpload(); setEditingTheme(targetTheme); setSaveError(""); }}
          >
            <span aria-hidden="true">{targetTheme === "light" ? "☼" : "☾"}</span>
            {targetTheme === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <p className={styles.hint}>Background in {editingTheme} mode.</p>
      <div className={styles.randomRow}>
        <div>
          <label id={randomLabelId} htmlFor={`${randomLabelId}-switch`}>Random</label>
          <p id={randomHintId}>Shuffle built-in images every 1–24 hours.</p>
        </div>
        <button
          id={`${randomLabelId}-switch`}
          type="button"
          role="switch"
          aria-checked={Boolean(appearance.preference.random?.[editingTheme])}
          aria-labelledby={randomLabelId}
          aria-describedby={randomHintId}
          className={styles.randomSwitch}
          onClick={toggleRandomBackground}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {initialPage === "new-tab" && (
        <>
        <div className={styles.spotifyChoice}>
          <button
            type="button"
            className={styles.spotifyButton}
            aria-pressed={ambient.spotify}
            onClick={() => toggleAmbient("spotify")}
          >
            <span className={styles.spotifyPreview} aria-hidden="true">
              <SpotifyAmbientBackground theme={editingTheme} />
              <Music2 />
            </span>
            <span><strong>Spotify colors</strong><small>Immersive, gently pulsing album colors, even while paused. {ambient.random ? "Random colors return when no track is selected." : "Your default background returns when no track is selected."}</small></span>
            {ambient.spotify && <Check size={16} aria-hidden="true" />}
          </button>
          {ambient.spotify && <p className={styles.hint} role="status">
            {spotifySource?.imageUrl
              ? `Following ${spotifySource.name} · ${spotifySource.artist}${spotifySource.playing ? "" : " · Paused"}`
              : ambient.random ? "Using random colors. Album colors take over when music plays." : "Using your default background. Play a track with album artwork to start the lights."}
          </p>}
        </div>
        <div className={styles.spotifyChoice}>
          <button
            type="button"
            className={styles.spotifyButton}
            aria-pressed={ambient.random}
            onClick={() => toggleAmbient("random")}
          >
            <span className={styles.spotifyPreview} aria-hidden="true">
              <SpotifyAmbientBackground theme={editingTheme} spotifyColors={false} randomColors />
              <Shuffle />
            </span>
            <span><strong>Random colors</strong><small>Slowly shifting colors with the same soft glow. Can be combined with Spotify colors.</small></span>
            {ambient.random && <Check size={16} aria-hidden="true" />}
          </button>
        </div>
        <RainAppearanceChoice mode={appearance.preference.rain?.[editingTheme] ?? "off"}
          onChange={mode => { void saveAppearance({ rain: { theme: editingTheme, mode } }); }} />
        </>
      )}
      <div
        className={styles.uploadCard}
        data-dragging={draggingImage || undefined}
        aria-busy={uploading}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingImage(true); }}
        onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDraggingImage(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingImage(false);
          const file = event.dataTransfer.files[0];
          if (file) void uploadFile(file);
        }}
      >
        <input ref={fileInputRef} type="file" accept={WALLPAPER_UPLOAD_ACCEPT} aria-label="Upload background image" className={styles.fileInput} onChange={uploadBackground} />
        {uploadedImage && (
          <div className={styles.uploadPreview} style={{ backgroundImage: `url("${uploadedImage}")` }} role="img" aria-label="Your uploaded background">
            <span><Check size={13} aria-hidden="true" /> Your image</span>
          </div>
        )}
        <div className={styles.uploadActions}>
          <button type="button" className={styles.upload} aria-label={uploadLabel} aria-describedby={uploadHintId} disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? <LoaderCircle size={18} className="is-spinning" aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
            <span>
              <strong>{uploadLabel}</strong>
              {!uploadedImage && <small>Choose a file or drop it here</small>}
            </span>
          </button>
          {uploadedImage && (
            <button type="button" className={styles.removeUpload} aria-label="Remove uploaded image" title="Remove uploaded image" onClick={() => selectBackground(editingTheme, NO_WALLPAPER_ID)}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p id={uploadHintId} className={styles.uploadHint}>JPG, PNG, WebP or AVIF · Up to 20 MB<br />Saved on this device.</p>
      </div>
      {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
      <button
        type="button"
        className="browser-wallpaper-none"
        aria-pressed={appearance.preference.backgrounds[editingTheme] === NO_WALLPAPER_ID}
        onClick={() => selectBackground(editingTheme, NO_WALLPAPER_ID)}
      >
        <span className="browser-wallpaper-none-preview" aria-hidden="true">
          <ImageOff />
          {appearance.preference.backgrounds[editingTheme] === NO_WALLPAPER_ID
            ? <span className="browser-wallpaper-check"><Check /></span>
            : null}
        </span>
        <span><strong>No image</strong><small>Use the Breadboard theme</small></span>
      </button>
      <div className="browser-wallpaper-source-tabs" style={{ gridTemplateColumns: `repeat(${initialPage === "new-tab" ? 3 : 2}, minmax(0, 1fr))` }} role="group" aria-label="Background source">
        {(["Generated", "Human", ...(initialPage === "new-tab" ? ["ASCII"] : [])] as BackgroundSource[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={source === value}
            onClick={() => chooseSource(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="browser-wallpaper-categories" aria-label="Background categories" hidden={source === "ASCII"}>
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
      {source === "ASCII" && <Suspense fallback={<p className={styles.hint} role="status">Loading ASCII library…</p>}>
        <AsciiWallpaperGallery selected={appearance.preference.backgrounds[editingTheme]} loading={loadingBackground}
          onSelect={value => { void selectBackground(editingTheme, value); }} />
      </Suspense>}
      <div className="browser-wallpaper-grid" hidden={source === "ASCII"}>
        {source === "Generated" ? visible.map((wallpaper) => {
          const selected = appearance.preference.backgrounds[editingTheme] === wallpaper.id;
          return (
            <button
              key={wallpaper.id}
              type="button"
              className="browser-wallpaper-option"
              aria-pressed={selected}
              aria-label={`${wallpaper.name}, ${wallpaper.category}`}
              onClick={() => selectBackground(editingTheme, wallpaper.id)}
            >
              <WallpaperThumbnail src={wallpaper.previewSrc} selected={selected} loading={loadingBackground === wallpaper.id} />
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
          const selected = appearance.preference.backgrounds[editingTheme] === wallpaperId;
          return (
            <button
              key={image.id}
              type="button"
              className="browser-wallpaper-option"
              aria-pressed={selected}
              aria-label={`${image.name}, photo by ${image.creator} on Pixabay`}
              onClick={() => selectBackground(editingTheme, wallpaperId)}
            >
              <WallpaperThumbnail src={image.previewSrc} lazy selected={selected} loading={loadingBackground === wallpaperId} />
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
    </div>
  );
}

function WallpaperThumbnail({ src, selected, loading, lazy = false }: { src: string; selected: boolean; loading: boolean; lazy?: boolean }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (image.complete && image.naturalWidth > 0) setStatus("ready");
    else if (loading) { setStatus("loading"); image.src = src; }
  }, [loading, src]);
  return <span className="browser-wallpaper-thumbnail" aria-busy={loading || status === "loading"}>
    {/* Small bundled previews load together; remote photos follow the scroll viewport. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={imageRef} src={src} alt="" loading={lazy ? "lazy" : "eager"} decoding="async" fetchPriority={lazy ? "auto" : "high"} onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
    {loading || status === "loading" ? <span className={styles.imageStatus} role="status"><LoaderCircle className="is-spinning" size={18} aria-hidden="true" /><span className="sr-only">Loading image</span></span> : null}
    {!loading && status === "error" ? <span className={styles.imageStatus}>Select to retry</span> : null}
    {selected ? <span className="browser-wallpaper-check"><Check aria-hidden="true" /></span> : null}
  </span>;
}
