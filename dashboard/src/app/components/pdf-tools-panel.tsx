"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SignaturePad, { type SignaturePadHandle } from "@/app/components/signature-pad";
import {
  addImageWatermark,
  addPageNumbers,
  addTextWatermark,
  canvasToImage,
  deletePages,
  extractPages,
  flattenForm,
  protectPdf,
  rasterizeText,
  readImageFile,
  readMetadata,
  rotatePages,
  writeMetadata,
  type FontFamily,
  type ImageBytes,
  type PdfMetadata,
} from "@/lib/pdf-tools";

export type PendingStamp = {
  image: ImageBytes;
  /** Natural width / natural height, used to centre the stamp on the click. */
  aspect: number;
  /** Stamp width as a fraction of the displayed page width. */
  relWidth: number;
  opacity: number;
};

type Props = {
  pageCount: number;
  readOnly: boolean;
  fileName: string;
  /** The bytes of the document as it currently stands, annotations included. */
  getBytes: () => Promise<Uint8Array>;
  /** Save the result and reopen the viewer on it. */
  applyBytes: (bytes: Uint8Array) => Promise<void>;
  downloadBytes: (bytes: Uint8Array, suffix: string) => void;
  /** Arm click-to-place on the page; the viewer stamps wherever the reader clicks. */
  startPlacement: (stamp: PendingStamp) => void;
  placementArmed: boolean;
  onCancelPlacement: () => void;
  onError: (message: string) => void;
  onClose: () => void;
};

type TabId = "watermark" | "sign" | "numbers" | "pages" | "metadata" | "protect";

const TABS: { id: TabId; label: string }[] = [
  { id: "watermark", label: "Watermark" },
  { id: "sign", label: "Sign" },
  { id: "numbers", label: "Numbers" },
  { id: "pages", label: "Pages" },
  { id: "metadata", label: "Metadata" },
  { id: "protect", label: "Protect" },
];

const FONT_FAMILIES: { id: FontFamily; label: string }[] = [
  { id: "helvetica", label: "Helvetica" },
  { id: "times", label: "Times" },
  { id: "courier", label: "Courier" },
];

const SIGNATURE_FONTS = [
  { id: "'Segoe Script', 'Brush Script MT', cursive", label: "Handwriting" },
  { id: "'Lucida Handwriting', 'Apple Chancery', cursive", label: "Script" },
  { id: "'Times New Roman', serif", label: "Serif" },
];

const SAVED_SIGNATURES_KEY = "sb:pdf-signatures";
const MAX_SAVED_SIGNATURES = 6;

const inputClass =
  "h-8 w-full rounded-md border border-gray-700 bg-gray-950 px-2 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-gray-500 disabled:opacity-40";
const buttonClass =
  "rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const primaryButtonClass =
  "w-full rounded-md border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-xs font-medium text-emerald-100 transition-colors hover:border-emerald-600 hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function bytesToDataUrl(image: ImageBytes): string {
  let binary = "";
  for (let index = 0; index < image.bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...image.bytes.subarray(index, index + 0x8000));
  }
  return `data:image/${image.type === "png" ? "png" : "jpeg"};base64,${btoa(binary)}`;
}

function dataUrlToBytes(dataUrl: string): ImageBytes {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, type: dataUrl.includes("image/png") ? "png" : "jpg" };
}

/** Signatures the reader kept, from the last time they signed something. */
function readSavedSignatures(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_SIGNATURES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    // A corrupt or unavailable store just means no saved signatures.
    return [];
  }
}

function imageAspect(image: ImageBytes): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element.naturalWidth / element.naturalHeight || 1);
    element.onerror = () => reject(new Error("That image could not be read."));
    element.src = bytesToDataUrl(image);
  });
}

/**
 * Stirling PDF's per-tool panels, rebuilt against the browser-side operations in
 * `@/lib/pdf-tools`. Everything runs on the bytes the viewer already holds — no
 * upload round-trip — and the viewer decides whether a result is saved back to
 * the garden or only downloaded.
 */
export default function PdfToolsPanel({
  pageCount,
  readOnly,
  fileName,
  getBytes,
  applyBytes,
  downloadBytes,
  startPlacement,
  placementArmed,
  onCancelPlacement,
  onError,
  onClose,
}: Props) {
  const [tab, setTab] = useState<TabId>("watermark");
  const [busy, setBusy] = useState("");

  const run = useCallback(
    async (
      label: string,
      produce: (bytes: Uint8Array) => Promise<Uint8Array>,
      destination: { mode: "apply" } | { mode: "download"; suffix: string },
    ) => {
      if (busy) return;
      setBusy(label);
      onError("");
      try {
        const next = await produce(await getBytes());
        if (destination.mode === "apply") {
          await applyBytes(next);
        } else {
          downloadBytes(next, destination.suffix);
        }
      } catch (error) {
        onError(
          error instanceof Error ? error.message : `Could not ${label.toLowerCase()}.`,
        );
      } finally {
        setBusy("");
      }
    },
    [applyBytes, busy, downloadBytes, getBytes, onError],
  );

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-gray-800 bg-gray-950 sm:w-80">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gray-800 px-3">
        <span className="text-sm font-medium text-white">Tools</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-900 hover:text-white"
          aria-label="Close tools"
          title="Close tools"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-gray-800 p-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              tab === item.id
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {readOnly && (
          <p className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1.5 text-[11px] leading-4 text-gray-400">
            This PDF is read-only, so changes stay in this tab. Use Download PDF to
            keep them.
          </p>
        )}

        {tab === "watermark" && (
          <WatermarkTab busy={busy} run={run} />
        )}
        {tab === "sign" && (
          <SignTab
            busy={busy}
            onError={onError}
            placementArmed={placementArmed}
            onCancelPlacement={onCancelPlacement}
            startPlacement={startPlacement}
          />
        )}
        {tab === "numbers" && (
          <PageNumbersTab busy={busy} run={run} fileName={fileName} />
        )}
        {tab === "pages" && (
          <PagesTab busy={busy} run={run} pageCount={pageCount} />
        )}
        {tab === "metadata" && (
          <MetadataTab busy={busy} run={run} getBytes={getBytes} onError={onError} />
        )}
        {tab === "protect" && <ProtectTab busy={busy} run={run} />}
      </div>
    </aside>
  );
}

type RunFn = (
  label: string,
  produce: (bytes: Uint8Array) => Promise<Uint8Array>,
  destination: { mode: "apply" } | { mode: "download"; suffix: string },
) => Promise<void>;

function WatermarkTab({ busy, run }: { busy: string; run: RunFn }) {
  const [kind, setKind] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [image, setImage] = useState<ImageBytes | null>(null);
  const [imageName, setImageName] = useState("");
  const [fontFamily, setFontFamily] = useState<FontFamily>("helvetica");
  const [fontSize, setFontSize] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [opacity, setOpacity] = useState(50);
  const [color, setColor] = useState("#d3d3d3");
  const [widthSpacer, setWidthSpacer] = useState(50);
  const [heightSpacer, setHeightSpacer] = useState(50);

  const apply = () => {
    if (kind === "text") {
      void run(
        "Add watermark",
        (bytes) =>
          addTextWatermark(bytes, {
            text,
            fontSize,
            rotation,
            opacity: opacity / 100,
            color,
            widthSpacer,
            heightSpacer,
            fontFamily,
          }),
        { mode: "apply" },
      );
      return;
    }
    if (!image) return;
    void run(
      "Add watermark",
      (bytes) =>
        addImageWatermark(bytes, image, {
          size: fontSize,
          rotation,
          opacity: opacity / 100,
          widthSpacer,
          heightSpacer,
        }),
      { mode: "apply" },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
        {(["text", "image"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setKind(item)}
            aria-pressed={kind === item}
            className={`flex-1 rounded px-2 py-1 text-[11px] capitalize transition-colors ${
              kind === item ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {kind === "text" ? (
        <>
          <Field label="Watermark text">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-gray-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Font">
              <select
                value={fontFamily}
                onChange={(event) => setFontFamily(event.target.value as FontFamily)}
                className={inputClass}
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Colour">
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-8 w-full rounded-md border border-gray-700 bg-gray-950"
              />
            </Field>
          </div>
        </>
      ) : (
        <Field label="Watermark image (PNG or JPG)">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImage(await readImageFile(file));
              setImageName(file.name);
            }}
            className="w-full text-[11px] text-gray-400 file:mr-2 file:rounded file:border file:border-gray-700 file:bg-gray-900 file:px-2 file:py-1 file:text-[11px] file:text-gray-300"
          />
        </Field>
      )}
      {kind === "image" && imageName && (
        <p className="truncate text-[11px] text-gray-500">{imageName}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={kind === "text" ? "Font size" : "Tile height"}>
          <input
            type="number"
            min={4}
            max={200}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Rotation">
          <input
            type="number"
            min={-180}
            max={180}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Opacity %">
          <input
            type="number"
            min={1}
            max={100}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Spacing X / Y">
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={widthSpacer}
              onChange={(event) => setWidthSpacer(Number(event.target.value))}
              className={inputClass}
            />
            <input
              type="number"
              min={0}
              value={heightSpacer}
              onChange={(event) => setHeightSpacer(Number(event.target.value))}
              className={inputClass}
            />
          </div>
        </Field>
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={
          Boolean(busy) || (kind === "text" ? !text.trim() : !image)
        }
        className={primaryButtonClass}
      >
        {busy === "Add watermark" ? "Adding watermark" : "Add watermark to every page"}
      </button>
    </div>
  );
}

function SignTab({
  busy,
  onError,
  placementArmed,
  onCancelPlacement,
  startPlacement,
}: {
  busy: string;
  onError: (message: string) => void;
  placementArmed: boolean;
  onCancelPlacement: () => void;
  startPlacement: (stamp: PendingStamp) => void;
}) {
  const [source, setSource] = useState<"draw" | "type" | "image">("draw");
  const [typedName, setTypedName] = useState("");
  const [signatureFont, setSignatureFont] = useState(SIGNATURE_FONTS[0].id);
  const [color, setColor] = useState("#111827");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [uploaded, setUploaded] = useState<ImageBytes | null>(null);
  const [width, setWidth] = useState(25);
  const [opacity, setOpacity] = useState(100);
  // The panel only mounts once the reader opens Tools, so reading storage here
  // never races hydration.
  const [saved, setSaved] = useState<string[]>(readSavedSignatures);
  const padRef = useRef<SignaturePadHandle | null>(null);

  const persist = useCallback((next: string[]) => {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_SIGNATURES_KEY, JSON.stringify(next));
    } catch {
      // Saving signatures is a convenience; never fail the signing flow over it.
    }
  }, []);

  const buildSignature = useCallback((): ImageBytes | null => {
    if (source === "draw") {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) {
        onError("Draw a signature first.");
        return null;
      }
      const canvas = pad.canvas();
      return canvas ? canvasToImage(canvas) : null;
    }
    if (source === "type") {
      if (!typedName.trim()) {
        onError("Type the name to sign with.");
        return null;
      }
      return rasterizeText(typedName.trim(), {
        fontSize: 64,
        color,
        cssFont: signatureFont,
        lineHeight: 1.3,
      }).image;
    }
    if (!uploaded) {
      onError("Choose a signature image first.");
      return null;
    }
    return uploaded;
  }, [color, onError, signatureFont, source, typedName, uploaded]);

  const place = useCallback(
    async (image: ImageBytes) => {
      try {
        startPlacement({
          image,
          aspect: await imageAspect(image),
          relWidth: width / 100,
          opacity: opacity / 100,
        });
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not read that image.");
      }
    },
    [onError, opacity, startPlacement, width],
  );

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
        {(["draw", "type", "image"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSource(item)}
            aria-pressed={source === item}
            className={`flex-1 rounded px-2 py-1 text-[11px] capitalize transition-colors ${
              source === item ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {source === "draw" && (
        <div className="space-y-2">
          <SignaturePad handleRef={padRef} color={color} strokeWidth={strokeWidth} />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-7 w-10 rounded border border-gray-700 bg-gray-950"
              aria-label="Ink colour"
            />
            <input
              type="range"
              min={1}
              max={8}
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
              className="flex-1"
              aria-label="Nib width"
            />
            <button
              type="button"
              onClick={() => padRef.current?.clear()}
              className={buttonClass}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {source === "type" && (
        <div className="space-y-2">
          <Field label="Name">
            <input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="Your name"
              className={inputClass}
            />
          </Field>
          <Field label="Style">
            <select
              value={signatureFont}
              onChange={(event) => setSignatureFont(event.target.value)}
              className={inputClass}
            >
              {SIGNATURE_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </Field>
          <p
            className="truncate rounded-md border border-gray-800 bg-gray-900 px-2 py-3 text-2xl text-white"
            style={{ fontFamily: signatureFont, color }}
          >
            {typedName || "Your name"}
          </p>
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-7 w-10 rounded border border-gray-700 bg-gray-950"
            aria-label="Ink colour"
          />
        </div>
      )}

      {source === "image" && (
        <Field label="Signature image (PNG or JPG)">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                setUploaded(await readImageFile(file));
              } catch (error) {
                onError(
                  error instanceof Error ? error.message : "Could not read that image.",
                );
              }
            }}
            className="w-full text-[11px] text-gray-400 file:mr-2 file:rounded file:border file:border-gray-700 file:bg-gray-900 file:px-2 file:py-1 file:text-[11px] file:text-gray-300"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Width % of page">
          <input
            type="number"
            min={2}
            max={100}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Opacity %">
          <input
            type="number"
            min={1}
            max={100}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      {placementArmed ? (
        <button type="button" onClick={onCancelPlacement} className={primaryButtonClass}>
          Click the page to drop it — or cancel
        </button>
      ) : (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            const image = buildSignature();
            if (image) void place(image);
          }}
          className={primaryButtonClass}
        >
          Place signature on the page
        </button>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={`${buttonClass} flex-1`}
          onClick={() => {
            const image = buildSignature();
            if (!image) return;
            persist([bytesToDataUrl(image), ...saved].slice(0, MAX_SAVED_SIGNATURES));
          }}
        >
          Save signature
        </button>
      </div>

      {saved.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Saved signatures
          </span>
          <div className="grid grid-cols-2 gap-2">
            {saved.map((dataUrl, index) => (
              <div
                key={`${index}-${dataUrl.slice(-16)}`}
                className="group relative rounded border border-gray-800 bg-white/90 p-1"
              >
                <button
                  type="button"
                  onClick={() => void place(dataUrlToBytes(dataUrl))}
                  className="block w-full"
                  title="Place this signature"
                >
                  {/* Signatures are local data URLs, so next/image would only add indirection. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={dataUrl} alt="Saved signature" className="h-10 w-full object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => persist(saved.filter((_, item) => item !== index))}
                  className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-gray-900/80 text-[10px] text-gray-300 group-hover:flex"
                  aria-label="Delete saved signature"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PageNumbersTab({
  busy,
  run,
  fileName,
}: {
  busy: string;
  run: RunFn;
  fileName: string;
}) {
  const [position, setPosition] = useState(8);
  const [startingNumber, setStartingNumber] = useState(1);
  const [pages, setPages] = useState("all");
  const [customText, setCustomText] = useState("{n}");
  const [zeroPad, setZeroPad] = useState(0);
  const [fontSize, setFontSize] = useState(12);
  const [fontFamily, setFontFamily] = useState<FontFamily>("helvetica");
  const [fontColor, setFontColor] = useState("#000000");
  const [margin, setMargin] = useState<"small" | "medium" | "large" | "x-large">("medium");

  return (
    <div className="space-y-3">
      <Field label="Position">
        <div className="grid w-24 grid-cols-3 gap-1">
          {Array.from({ length: 9 }, (_, index) => index + 1).map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => setPosition(slot)}
              aria-pressed={position === slot}
              aria-label={`Position ${slot}`}
              className={`h-6 rounded border text-[10px] transition-colors ${
                position === slot
                  ? "border-emerald-600 bg-emerald-900/50 text-white"
                  : "border-gray-800 bg-gray-900 text-gray-600 hover:border-gray-600"
              }`}
            >
              {slot}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Pages">
          <input
            value={pages}
            onChange={(event) => setPages(event.target.value)}
            placeholder="all, odd, 2-9"
            className={inputClass}
          />
        </Field>
        <Field label="Start at">
          <input
            type="number"
            min={0}
            value={startingNumber}
            onChange={(event) => setStartingNumber(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Text — {n}, {total}, {filename}">
        <input
          value={customText}
          onChange={(event) => setCustomText(event.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Font">
          <select
            value={fontFamily}
            onChange={(event) => setFontFamily(event.target.value as FontFamily)}
            className={inputClass}
          >
            {FONT_FAMILIES.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <input
            type="number"
            min={4}
            max={72}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Colour">
          <input
            type="color"
            value={fontColor}
            onChange={(event) => setFontColor(event.target.value)}
            className="h-8 w-full rounded-md border border-gray-700 bg-gray-950"
          />
        </Field>
        <Field label="Margin">
          <select
            value={margin}
            onChange={(event) =>
              setMargin(event.target.value as "small" | "medium" | "large" | "x-large")
            }
            className={inputClass}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="x-large">X-large</option>
          </select>
        </Field>
        <Field label="Zero padding">
          <input
            type="number"
            min={0}
            max={6}
            value={zeroPad}
            onChange={(event) => setZeroPad(Number(event.target.value))}
            className={inputClass}
          />
        </Field>
      </div>

      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() =>
          void run(
            "Add page numbers",
            (bytes) =>
              addPageNumbers(bytes, {
                position,
                startingNumber,
                pages,
                customText,
                zeroPad,
                fontSize,
                fontFamily,
                fontColor,
                margin,
                fileName,
              }),
            { mode: "apply" },
          )
        }
        className={primaryButtonClass}
      >
        {busy === "Add page numbers" ? "Numbering pages" : "Add page numbers"}
      </button>
    </div>
  );
}

function PagesTab({
  busy,
  run,
  pageCount,
}: {
  busy: string;
  run: RunFn;
  pageCount: number;
}) {
  const [pages, setPages] = useState("all");

  return (
    <div className="space-y-3">
      <Field label={`Pages — 1 to ${pageCount || "?"}`}>
        <input
          value={pages}
          onChange={(event) => setPages(event.target.value)}
          placeholder="all, odd, even, 1,3,5-9"
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("Rotate pages", (bytes) => rotatePages(bytes, pages, -90), {
              mode: "apply",
            })
          }
          className={buttonClass}
        >
          Rotate left
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("Rotate pages", (bytes) => rotatePages(bytes, pages, 90), {
              mode: "apply",
            })
          }
          className={buttonClass}
        >
          Rotate right
        </button>
      </div>

      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() =>
          void run("Extract pages", (bytes) => extractPages(bytes, pages), {
            mode: "download",
            suffix: "extract",
          })
        }
        className={`${buttonClass} w-full`}
      >
        Download just those pages
      </button>

      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() =>
          void run("Flatten form", (bytes) => flattenForm(bytes), { mode: "apply" })
        }
        className={`${buttonClass} w-full`}
      >
        Flatten form fields
      </button>

      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => {
          if (!window.confirm(`Delete pages "${pages}" from this PDF?`)) return;
          void run("Delete pages", (bytes) => deletePages(bytes, pages), {
            mode: "apply",
          });
        }}
        className="w-full rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200 transition-colors hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "Delete pages" ? "Deleting pages" : "Delete those pages"}
      </button>
    </div>
  );
}

function MetadataTab({
  busy,
  run,
  getBytes,
  onError,
}: {
  busy: string;
  run: RunFn;
  getBytes: () => Promise<Uint8Array>;
  onError: (message: string) => void;
}) {
  const empty = useMemo<PdfMetadata>(
    () => ({ title: "", author: "", subject: "", keywords: "", creator: "", producer: "" }),
    [],
  );
  const [metadata, setMetadata] = useState<PdfMetadata>(empty);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await readMetadata(await getBytes());
        if (!cancelled) setMetadata(current);
      } catch (error) {
        if (!cancelled) {
          onError(
            error instanceof Error ? error.message : "Could not read the PDF metadata.",
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getBytes, onError]);

  const fields: { key: keyof PdfMetadata; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "author", label: "Author" },
    { key: "subject", label: "Subject" },
    { key: "keywords", label: "Keywords" },
    { key: "creator", label: "Creator" },
    { key: "producer", label: "Producer" },
  ];

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          <input
            value={metadata[field.key]}
            disabled={!loaded}
            onChange={(event) =>
              setMetadata((current) => ({ ...current, [field.key]: event.target.value }))
            }
            className={inputClass}
          />
        </Field>
      ))}
      <button
        type="button"
        disabled={Boolean(busy) || !loaded}
        onClick={() =>
          void run("Save metadata", (bytes) => writeMetadata(bytes, metadata), {
            mode: "apply",
          })
        }
        className={primaryButtonClass}
      >
        {busy === "Save metadata" ? "Saving metadata" : "Save metadata"}
      </button>
    </div>
  );
}

function ProtectTab({ busy, run }: { busy: string; run: RunFn }) {
  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [permissions, setPermissions] = useState({
    printing: true,
    modifying: false,
    copying: false,
    annotating: false,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: false,
  });

  const toggles: { key: keyof typeof permissions; label: string }[] = [
    { key: "printing", label: "Printing" },
    { key: "copying", label: "Copying text" },
    { key: "modifying", label: "Modifying" },
    { key: "annotating", label: "Annotating" },
    { key: "fillingForms", label: "Filling forms" },
    { key: "documentAssembly", label: "Assembling pages" },
    { key: "contentAccessibility", label: "Screen readers" },
  ];

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1.5 text-[11px] leading-4 text-gray-400">
        An encrypted copy downloads to your machine. The stored PDF is left alone, so
        the viewer can still open it.
      </p>
      <Field label="Password to open">
        <input
          type="password"
          value={userPassword}
          onChange={(event) => setUserPassword(event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Owner password (full access)">
        <input
          type="password"
          value={ownerPassword}
          onChange={(event) => setOwnerPassword(event.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Allowed with the open password
        </span>
        {toggles.map((toggle) => (
          <label key={toggle.key} className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={permissions[toggle.key]}
              onChange={(event) =>
                setPermissions((current) => ({
                  ...current,
                  [toggle.key]: event.target.checked,
                }))
              }
            />
            {toggle.label}
          </label>
        ))}
      </div>

      <button
        type="button"
        disabled={Boolean(busy) || (!userPassword && !ownerPassword)}
        onClick={() =>
          void run(
            "Protect PDF",
            (bytes) => protectPdf(bytes, { userPassword, ownerPassword, permissions }),
            { mode: "download", suffix: "protected" },
          )
        }
        className={primaryButtonClass}
      >
        {busy === "Protect PDF" ? "Encrypting" : "Download protected copy"}
      </button>
    </div>
  );
}
