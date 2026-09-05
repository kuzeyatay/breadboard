"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, ImageOff, LoaderCircle, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { applyAppTheme } from "@/lib/app-theme";
import { prepareWallpaperUpload, WALLPAPER_UPLOAD_ACCEPT } from "@/lib/wallpaper-upload";
import {
  APPEARANCE_PAGES,
  WALLPAPERS,
  NO_WALLPAPER_ID,
  type AppearancePage,
  type AppearanceTheme,
  type WallpaperCategory,
} from "@/lib/page-appearance";
import { usePageAppearance } from "./use-page-appearance";
import styles from "./page-appearance.module.css";

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

export default function PageAppearance({ page, ownerKey, initialOpen = false }: { page: AppearancePage; ownerKey: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className={styles.anchor} data-page={page}>
        <Dialog.Trigger asChild>
          <button type="button" className={styles.customizeButton} aria-label="Customize appearance" title="Customize appearance">
            <Pencil size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content className={`browser-wallpaper-drawer ${styles.drawer}`} data-open="true">
          <header>
            <Dialog.Title asChild><strong>Appearance</strong></Dialog.Title>
            <Dialog.Close aria-label="Close appearance"><X aria-hidden="true" /></Dialog.Close>
          </header>
          <Dialog.Description className={styles.description}>Your theme and backgrounds, saved automatically.</Dialog.Description>
          {open && <AppearanceChoices initialPage={page} ownerKey={ownerKey} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppearanceChoices({ initialPage, ownerKey }: { initialPage: AppearancePage; ownerKey: string }) {
  const [editingPage, setEditingPage] = useState(initialPage);
  const appearance = usePageAppearance(ownerKey, editingPage);
  const [editingTheme, setEditingTheme] = useState<AppearanceTheme>(appearance.theme);
  const [saveError, setSaveError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadHintId = useId();
  const uploadRequest = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [category, setCategory] = useState<"All" | WallpaperCategory>("All");
  const [source, setSource] = useState<"Generated" | "Human">("Generated");
  const [pixabayQuery, setPixabayQuery] = useState("");
  const [pixabayRequest, setPixabayRequest] = useState("");
  const [pixabayImages, setPixabayImages] = useState<PixabayWallpaper[]>([]);
  const [pixabayLoading, setPixabayLoading] = useState(false);
  const [pixabayError, setPixabayError] = useState("");

  useEffect(() => () => { uploadRequest.current += 1; }, []);

  function cancelUpload() {
    uploadRequest.current += 1;
    setUploading(false);
  }

  useEffect(() => {
    if (source !== "Human" || !pixabayRequest) return;
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
  }, [pixabayRequest, source]);

  const visible = category === "All"
    ? WALLPAPERS
    : WALLPAPERS.filter((wallpaper) => wallpaper.category === category);

  const chooseSource = (nextSource: "Generated" | "Human") => {
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
    setPixabayRequest(pixabayQuery.trim() || PIXABAY_CATEGORY_QUERIES[category]);
  };

  function selectPage(page: AppearancePage) {
    cancelUpload();
    setEditingPage(page);
    setSaveError("");
  }

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

  function selectBackground(theme: AppearanceTheme, value: string) {
    cancelUpload();
    try {
      appearance.save({ background: { theme, value } });
      setSaveError("");
    } catch {
      setSaveError("Couldn’t save the background. Try a smaller image or free some browser storage.");
    }
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

  return (
    <div className={styles.choices}>
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
      <div className={styles.pageTabs} role="group" aria-label="Page to customize">
        {(Object.entries(APPEARANCE_PAGES) as [AppearancePage, string][]).map(([page, label]) => (
          <button key={page} type="button" aria-pressed={editingPage === page} onClick={() => selectPage(page)}>{label}</button>
        ))}
      </div>
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
      <p className={styles.hint}>Background for {APPEARANCE_PAGES[editingPage]} in {editingTheme} mode.</p>
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
      <div className="browser-wallpaper-source-tabs" role="group" aria-label="Background source">
        {(["Generated", "Human"] as const).map((value) => (
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
    </div>
  );
}
