// Client-side PDF operations, ported from Stirling PDF's server-side tools
// (WatermarkController, PageNumbersController, StampController) onto pdf-lib so
// they run in the browser against the bytes the viewer already has open. Every
// operation takes the current PDF bytes and returns new bytes; the viewer is
// what decides whether those bytes get saved to the server or only downloaded.
//
// Some helpers rasterise text through a <canvas>, so this module is browser-only.

import {
  degrees,
  PDFDocument,
  PDFFont,
  rgb,
  StandardFonts,
} from "@cantoo/pdf-lib";

export type FontFamily = "helvetica" | "times" | "courier";
export type ImageBytes = { bytes: Uint8Array; type: "png" | "jpg" };

export type WatermarkOptions = {
  text: string;
  fontSize: number;
  rotation: number;
  /** 0-1. */
  opacity: number;
  /** Hex colour, e.g. "#d3d3d3". */
  color: string;
  widthSpacer: number;
  heightSpacer: number;
  fontFamily: FontFamily;
};

export type ImageWatermarkOptions = {
  /** Height of one tile in points; width follows the image aspect ratio. */
  size: number;
  rotation: number;
  opacity: number;
  widthSpacer: number;
  heightSpacer: number;
};

export type PageNumberOptions = {
  /** 1-9, reading like a numeric keypad: 1 = top-left, 9 = bottom-right. */
  position: number;
  startingNumber: number;
  /** Page selection string: "all", "odd", "even", "1,3,5-9". */
  pages: string;
  /** Supports {n}, {total} and {filename}. */
  customText: string;
  zeroPad: number;
  fontSize: number;
  fontFamily: FontFamily;
  fontColor: string;
  margin: "small" | "medium" | "large" | "x-large";
  fileName: string;
};

export type StampPlacement = {
  pageIndex: number;
  /** 0-1, measured from the left edge of the page as displayed. */
  relX: number;
  /** 0-1, measured from the top edge of the page as displayed. */
  relY: number;
  /** Stamp width as a fraction of the displayed page width. */
  relWidth: number;
  opacity: number;
};

export type PdfMetadata = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
};

export type ProtectOptions = {
  userPassword: string;
  ownerPassword: string;
  permissions: {
    printing: boolean;
    modifying: boolean;
    copying: boolean;
    annotating: boolean;
    fillingForms: boolean;
    contentAccessibility: boolean;
    documentAssembly: boolean;
  };
};

const MARGIN_FACTORS: Record<PageNumberOptions["margin"], number> = {
  small: 0.02,
  medium: 0.035,
  large: 0.05,
  "x-large": 0.075,
};

const STANDARD_FONTS: Record<FontFamily, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
};

/** CSS font stacks used when text has to be rasterised instead of drawn as glyphs. */
const CSS_FONTS: Record<FontFamily, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};

/** Supersampling used when rasterising text, so raster fallbacks stay crisp when zoomed. */
const RASTER_SCALE = 4;

export function hexToRgb(hex: string, fallback = "#d3d3d3") {
  const cleaned = /^#?[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : fallback;
  const value = cleaned.replace("#", "");
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
}

/** The standard 14 fonts only cover WinAnsi, so anything outside it has to be rasterised. */
function canEncode(font: PDFFont, text: string): boolean {
  try {
    for (const line of text.split("\n")) font.encodeText(line);
    return true;
  } catch {
    return false;
  }
}

function detectImageType(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

export async function readImageFile(file: File): Promise<ImageBytes> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new Error("Only PNG and JPG images can be embedded in a PDF.");
  return { bytes, type };
}

async function embedImage(pdf: PDFDocument, image: ImageBytes) {
  return image.type === "png" ? pdf.embedPng(image.bytes) : pdf.embedJpg(image.bytes);
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL("image/png");
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Draw text into a transparent PNG sized in PDF points. Used for scripts the
 * standard 14 fonts cannot encode (Turkish ş/ğ, Greek, CJK, ...) and for typed
 * signatures, where a handwriting face matters more than a vector glyph.
 */
export function rasterizeText(
  text: string,
  options: {
    fontSize: number;
    color: string;
    cssFont: string;
    /** Multiplied by fontSize; 1.2 leaves normal line spacing. */
    lineHeight?: number;
  },
): { image: ImageBytes; width: number; height: number } {
  const lines = text.split("\n");
  const lineHeight = options.fontSize * (options.lineHeight ?? 1);
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("This browser cannot render text to an image.");

  const font = `${options.fontSize}px ${options.cssFont}`;
  measure.font = font;
  const width = Math.max(
    1,
    ...lines.map((line) => Math.ceil(measure.measureText(line).width)),
  );
  const height = Math.max(1, Math.ceil(lineHeight * lines.length));

  const canvas = document.createElement("canvas");
  canvas.width = width * RASTER_SCALE;
  canvas.height = height * RASTER_SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot render text to an image.");
  context.scale(RASTER_SCALE, RASTER_SCALE);
  context.font = font;
  context.fillStyle = options.color;
  context.textBaseline = "alphabetic";
  lines.forEach((line, index) => {
    // 0.8 of the line box is a reasonable ascent for the faces used here.
    context.fillText(line, 0, lineHeight * index + options.fontSize * 0.8);
  });

  return {
    image: { bytes: canvasToPngBytes(canvas), type: "png" },
    width,
    height,
  };
}

/** PNG bytes for whatever has been drawn on a signature pad canvas. */
export function canvasToImage(canvas: HTMLCanvasElement): ImageBytes {
  return { bytes: canvasToPngBytes(canvas), type: "png" };
}

/**
 * Page selection in Stirling's syntax: "all", "odd", "even", "3", "2-7" and any
 * comma-separated mix of those. Returns sorted, de-duplicated 0-based indices.
 */
export function parsePageSelection(input: string, pageCount: number): number[] {
  const selection = input.trim().toLowerCase();
  const all = Array.from({ length: pageCount }, (_, index) => index);
  if (!selection || selection === "all") return all;
  if (selection === "odd") return all.filter((index) => index % 2 === 0);
  if (selection === "even") return all.filter((index) => index % 2 === 1);

  const pages = new Set<number>();
  for (const part of selection.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let page = Math.min(from, to); page <= Math.max(from, to); page += 1) {
        if (page >= 1 && page <= pageCount) pages.add(page - 1);
      }
      continue;
    }
    const single = Number(token);
    if (Number.isInteger(single) && single >= 1 && single <= pageCount) {
      pages.add(single - 1);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Map a point on the page as the reader sees it (origin top-left, y down) to PDF
 * user space, which is where pdf-lib draws. The two differ whenever the page
 * carries a /Rotate entry.
 */
function displayToUser(
  displayX: number,
  displayY: number,
  mediaWidth: number,
  mediaHeight: number,
  rotation: number,
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: displayY, y: displayX };
    case 180:
      return { x: mediaWidth - displayX, y: displayY };
    case 270:
      return { x: mediaWidth - displayY, y: mediaHeight - displayX };
    default:
      return { x: displayX, y: mediaHeight - displayY };
  }
}

function normalizedRotation(angle: number): number {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

export async function addTextWatermark(
  pdfBytes: Uint8Array,
  options: WatermarkOptions,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const font = await pdf.embedFont(STANDARD_FONTS[options.fontFamily]);
  const lines = options.text.split(/\\n|\n/);
  const radians = (options.rotation * Math.PI) / 180;
  const drawable = canEncode(font, lines.join("\n"));

  // Scripts the standard fonts cannot encode get tiled as an image instead.
  const raster = drawable
    ? null
    : rasterizeText(lines.join("\n"), {
        fontSize: options.fontSize,
        color: options.color,
        cssFont: CSS_FONTS[options.fontFamily],
      });
  const embedded = raster ? await embedImage(pdf, raster.image) : null;

  const textWidth = raster
    ? raster.width
    : Math.max(...lines.map((line) => font.widthOfTextAtSize(line, options.fontSize)));
  const textHeight = raster ? raster.height : options.fontSize * lines.length;

  // Tile geometry follows Stirling's WatermarkController: the un-rotated tile
  // size is grown to its rotated bounding box so rotated tiles do not overlap.
  const tileWidth = options.widthSpacer + textWidth;
  const tileHeight = options.heightSpacer + textHeight;
  const stepX =
    Math.abs(tileWidth * Math.cos(radians)) + Math.abs(tileHeight * Math.sin(radians));
  const stepY =
    Math.abs(tileWidth * Math.sin(radians)) + Math.abs(tileHeight * Math.cos(radians));

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const rows = Math.min(Math.floor(height / Math.max(stepY, 1)) + 1, 500);
    const columns = Math.min(Math.floor(width / Math.max(stepX, 1)) + 1, 500);

    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const x = column * stepX;
        const y = row * stepY;
        if (embedded && raster) {
          page.drawImage(embedded, {
            x,
            y: y - raster.height,
            width: raster.width,
            height: raster.height,
            rotate: degrees(options.rotation),
            opacity: options.opacity,
          });
        } else {
          page.drawText(lines.join("\n"), {
            x,
            y,
            font,
            size: options.fontSize,
            color: hexToRgb(options.color),
            opacity: options.opacity,
            rotate: degrees(options.rotation),
            lineHeight: options.fontSize,
          });
        }
      }
    }
  }

  return pdf.save();
}

export async function addImageWatermark(
  pdfBytes: Uint8Array,
  image: ImageBytes,
  options: ImageWatermarkOptions,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const embedded = await embedImage(pdf, image);
  const tileHeight = options.size;
  const tileWidth = tileHeight * (embedded.width / embedded.height);
  const radians = (options.rotation * Math.PI) / 180;

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const rows = Math.min(
      Math.floor((height + options.heightSpacer) / (tileHeight + options.heightSpacer)),
      500,
    );
    const columns = Math.min(
      Math.floor((width + options.widthSpacer) / (tileWidth + options.widthSpacer)),
      500,
    );

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const centerX = column * (tileWidth + options.widthSpacer) + tileWidth / 2;
        const centerY = row * (tileHeight + options.heightSpacer) + tileHeight / 2;
        // pdf-lib rotates about the anchor, so place the anchor where the
        // rotated tile's own bottom-left corner lands.
        page.drawImage(embedded, {
          x:
            centerX +
            (-tileWidth / 2) * Math.cos(radians) -
            (-tileHeight / 2) * Math.sin(radians),
          y:
            centerY +
            (-tileWidth / 2) * Math.sin(radians) +
            (-tileHeight / 2) * Math.cos(radians),
          width: tileWidth,
          height: tileHeight,
          rotate: degrees(options.rotation),
          opacity: options.opacity,
        });
      }
    }
  }

  return pdf.save();
}

export async function addPageNumbers(
  pdfBytes: Uint8Array,
  options: PageNumberOptions,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const font = await pdf.embedFont(STANDARD_FONTS[options.fontFamily]);
  const pages = parsePageSelection(options.pages, pdf.getPageCount());
  const marginFactor = MARGIN_FACTORS[options.margin] ?? MARGIN_FACTORS.medium;
  const total = pdf.getPageCount();
  const template = options.customText.trim() || "{n}";
  const baseName = options.fileName.replace(/\.[^.]+$/, "");
  const position = Math.max(1, Math.min(9, options.position));
  const column = ((position - 1) % 3) + 1;
  const row = Math.floor((position - 1) / 3) + 1;

  let counter = options.startingNumber;
  for (const pageIndex of pages) {
    const page = pdf.getPage(pageIndex);
    const { width, height } = page.getSize();
    const numbered =
      options.zeroPad > 0
        ? String(counter).padStart(options.zeroPad, "0")
        : String(counter);
    const text = template
      .replace(/\{n\}/g, numbered)
      .replace(/\{total\}/g, String(total))
      .replace(/\{filename\}/g, baseName);

    const drawable = canEncode(font, text);
    const textWidth = drawable
      ? font.widthOfTextAtSize(text, options.fontSize)
      : rasterizeText(text, {
          fontSize: options.fontSize,
          color: options.fontColor,
          cssFont: CSS_FONTS[options.fontFamily],
        }).width;
    const ascent = font.heightAtSize(options.fontSize, { descender: false });
    const descent = font.heightAtSize(options.fontSize) - ascent;

    const x =
      column === 1
        ? marginFactor * width
        : column === 2
          ? width / 2 - textWidth / 2
          : width - marginFactor * width - textWidth;
    const y =
      row === 1
        ? height - marginFactor * height - ascent
        : row === 2
          ? height / 2 - (ascent - descent) / 2
          : marginFactor * height;

    if (drawable) {
      page.drawText(text, {
        x,
        y,
        font,
        size: options.fontSize,
        color: hexToRgb(options.fontColor, "#000000"),
      });
    } else {
      const raster = rasterizeText(text, {
        fontSize: options.fontSize,
        color: options.fontColor,
        cssFont: CSS_FONTS[options.fontFamily],
      });
      const embedded = await embedImage(pdf, raster.image);
      page.drawImage(embedded, {
        x,
        y: y - descent,
        width: raster.width,
        height: raster.height,
      });
    }

    counter += 1;
  }

  return pdf.save();
}

/**
 * Drop an image — a signature, a stamp, a logo — onto one page at a spot the
 * reader picked on screen. Placement is given in displayed-page fractions and
 * converted here, so a page with a /Rotate entry lands the stamp where it looked
 * like it would land.
 */
export async function stampImage(
  pdfBytes: Uint8Array,
  image: ImageBytes,
  placement: StampPlacement,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const page = pdf.getPage(placement.pageIndex);
  const embedded = await embedImage(pdf, image);
  const { width: mediaWidth, height: mediaHeight } = page.getSize();
  const rotation = normalizedRotation(page.getRotation().angle);
  const rotated = rotation === 90 || rotation === 270;
  const displayWidth = rotated ? mediaHeight : mediaWidth;
  const displayHeight = rotated ? mediaWidth : mediaHeight;

  const stampWidth = placement.relWidth * displayWidth;
  const stampHeight = stampWidth * (embedded.height / embedded.width);
  const anchor = displayToUser(
    placement.relX * displayWidth,
    placement.relY * displayHeight + stampHeight,
    mediaWidth,
    mediaHeight,
    rotation,
  );

  page.drawImage(embedded, {
    x: anchor.x,
    y: anchor.y,
    width: stampWidth,
    height: stampHeight,
    rotate: degrees(rotation),
    opacity: placement.opacity,
  });

  return pdf.save();
}

export async function rotatePages(
  pdfBytes: Uint8Array,
  pages: string,
  delta: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  for (const index of parsePageSelection(pages, pdf.getPageCount())) {
    const page = pdf.getPage(index);
    page.setRotation(degrees(normalizedRotation(page.getRotation().angle + delta)));
  }
  return pdf.save();
}

export async function deletePages(
  pdfBytes: Uint8Array,
  pages: string,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const doomed = parsePageSelection(pages, pdf.getPageCount());
  if (doomed.length === 0) throw new Error("That page selection matches no pages.");
  if (doomed.length >= pdf.getPageCount()) {
    throw new Error("A PDF cannot have every page removed.");
  }
  // Remove from the back so earlier indices stay valid.
  for (const index of [...doomed].reverse()) pdf.removePage(index);
  return pdf.save();
}

export async function extractPages(
  pdfBytes: Uint8Array,
  pages: string,
): Promise<Uint8Array> {
  const source = await loadPdf(pdfBytes);
  const wanted = parsePageSelection(pages, source.getPageCount());
  if (wanted.length === 0) throw new Error("That page selection matches no pages.");
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, wanted);
  for (const page of copied) target.addPage(page);
  return target.save();
}

export async function flattenForm(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  const form = pdf.getForm();
  if (form.getFields().length === 0) {
    throw new Error("This PDF has no form fields to flatten.");
  }
  form.flatten();
  return pdf.save();
}

export async function readMetadata(pdfBytes: Uint8Array): Promise<PdfMetadata> {
  const pdf = await loadPdf(pdfBytes);
  return {
    title: pdf.getTitle() ?? "",
    author: pdf.getAuthor() ?? "",
    subject: pdf.getSubject() ?? "",
    keywords: pdf.getKeywords() ?? "",
    creator: pdf.getCreator() ?? "",
    producer: pdf.getProducer() ?? "",
  };
}

export async function writeMetadata(
  pdfBytes: Uint8Array,
  metadata: PdfMetadata,
): Promise<Uint8Array> {
  const pdf = await loadPdf(pdfBytes);
  pdf.setTitle(metadata.title);
  pdf.setAuthor(metadata.author);
  pdf.setSubject(metadata.subject);
  // Keywords is one free-text string in the PDF info dictionary; pdf-lib joins an
  // array with spaces, so splitting on commas here would silently eat them.
  pdf.setKeywords(metadata.keywords ? [metadata.keywords] : []);
  pdf.setCreator(metadata.creator);
  pdf.setProducer(metadata.producer);
  pdf.setModificationDate(new Date());
  return pdf.save();
}

export async function protectPdf(
  pdfBytes: Uint8Array,
  options: ProtectOptions,
): Promise<Uint8Array> {
  if (!options.userPassword && !options.ownerPassword) {
    throw new Error("Set an open password, an owner password, or both.");
  }
  const pdf = await loadPdf(pdfBytes);
  pdf.encrypt({
    userPassword: options.userPassword || undefined,
    ownerPassword: options.ownerPassword || options.userPassword,
    permissions: {
      printing: options.permissions.printing ? "highResolution" : undefined,
      modifying: options.permissions.modifying,
      copying: options.permissions.copying,
      annotating: options.permissions.annotating,
      fillingForms: options.permissions.fillingForms,
      contentAccessibility: options.permissions.contentAccessibility,
      documentAssembly: options.permissions.documentAssembly,
    },
  });
  return pdf.save();
}
