import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import type OpenAI from "openai";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  DEFAULT_MODEL,
  createChatmockClient,
  extractDocumentKnowledge,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "@/lib/knowledge";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

interface PdfScreenshotPage {
  pageNumber: number;
  dataUrl: string;
}

function imageMimeType(mimeType: string, ext = ""): string {
  if (mimeType.startsWith("image/")) return mimeType;
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function mimeToBase64Prefix(mimeType: string, ext = ""): string {
  const normalized = imageMimeType(mimeType, ext);
  if (normalized === "image/png") return "data:image/png;base64,";
  if (normalized === "image/webp") return "data:image/webp;base64,";
  return "data:image/jpeg;base64,";
}

function isImageExt(ext: string): boolean {
  return ["jpg", "jpeg", "png", "webp"].includes(ext);
}

function pageMarkdown(pages: DocumentPage[]): string {
  return pages
    .map((page) => {
      const image = page.imagePath
        ? `![${page.imageAlt || page.label}](${page.imagePath})\n\n`
        : "";
      return `## ${page.label}\n\n${image}${page.text.trim() || "_No legible text found._"}`;
    })
    .join("\n\n");
}

function pagePlainText(pages: DocumentPage[]): string {
  return pages
    .map(
      (page) =>
        `[[${page.label}]]\n${page.text.trim() || "No legible text found."}`,
    )
    .join("\n\n");
}

function dataUrlToImage(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid screenshot data URL");
  const mimeType = match[1].toLowerCase();
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  return { buffer: Buffer.from(match[2], "base64"), ext };
}

function uniqueAssetPath(
  assetDir: string,
  baseName: string,
  ext: string,
): string {
  let counter = 1;
  let filePath = path.join(assetDir, `${baseName}.${ext}`);
  while (fs.existsSync(filePath)) {
    counter += 1;
    filePath = path.join(assetDir, `${baseName}-${counter}.${ext}`);
  }
  return filePath;
}

function saveDataUrlAsset({
  contentPath,
  clusterSlug,
  baseName,
  label,
  dataUrl,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  label: string;
  dataUrl: string;
}): string {
  const { buffer, ext } = dataUrlToImage(dataUrl);
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const fileBase = slugify(`${baseName}-${label}`);
  const filePath = uniqueAssetPath(assetDir, fileBase, ext);
  fs.writeFileSync(filePath, buffer);
  return `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`;
}

function saveUploadedPdfAsset({
  contentPath,
  clusterSlug,
  baseName,
  buffer,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  buffer: Buffer;
}): string {
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const fileBase = slugify(`${baseName}-source`);
  const filePath = uniqueAssetPath(assetDir, fileBase, "pdf");
  fs.writeFileSync(filePath, buffer);
  return `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`;
}

function pageNumberFromLabel(label: string): number | undefined {
  const cleanLabel = label.trim();
  const prefixed = [
    ...cleanLabel.matchAll(
      /\b(?:pages?|p\.?|slides?)\s*[-#:]*\s*(\d{1,5})\b/gi,
    ),
  ];
  if (prefixed.length > 0) {
    return Number.parseInt(prefixed[prefixed.length - 1][1], 10);
  }

  const pathStyle = cleanLabel.match(
    /(?:^|[-_/\\])page[-_\s]*(\d{1,5})(?:\D|$)/i,
  );
  if (pathStyle) return Number.parseInt(pathStyle[1], 10);

  const bare = cleanLabel.match(/^\s*(\d{1,5})\s*$/);
  return bare ? Number.parseInt(bare[1], 10) : undefined;
}

function attachPdfScreenshotAssets({
  pages,
  screenshots,
  contentPath,
  clusterSlug,
  sourceTitle,
}: {
  pages: DocumentPage[];
  screenshots: PdfScreenshotPage[];
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
}): DocumentPage[] {
  const imageByPageNumber = new Map<number, string>();
  for (const screenshot of screenshots) {
    const imagePath = saveDataUrlAsset({
      contentPath,
      clusterSlug,
      baseName: sourceTitle,
      label: `page-${String(screenshot.pageNumber).padStart(3, "0")}`,
      dataUrl: screenshot.dataUrl,
    });
    imageByPageNumber.set(screenshot.pageNumber, imagePath);
  }

  return pages.map((page) => {
    const pageNumber = pageNumberFromLabel(page.label);
    const imagePath = pageNumber
      ? imageByPageNumber.get(pageNumber)
      : undefined;
    if (!imagePath) return page;
    return {
      ...page,
      imagePath,
      imageAlt: `${sourceTitle} ${page.label}`,
    };
  });
}

function markdownSnapshots(pages: DocumentPage[]): string {
  return pages
    .filter((page) => page.imagePath)
    .map((page) => `![${page.imageAlt || page.label}](${page.imagePath})`)
    .join("\n\n");
}

function appendSnapshots(markdownText: string, pages: DocumentPage[]): string {
  const snapshots = markdownSnapshots(pages);
  if (!snapshots) return markdownText;
  return `${markdownText.trim()}\n\n## Source snapshots\n\n${snapshots}`;
}

async function transcribePageImage({
  client,
  dataUrl,
  label,
  isHandwriting,
}: {
  client: OpenAI;
  dataUrl: string;
  label: string;
  isHandwriting: boolean;
}): Promise<string> {
  const response = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: isHandwriting
              ? `Transcribe ${label} from a handwritten or scanned document as source notes for a study graph. Preserve every legible heading, equation, bullet, label, worked example, table entry, and line break. Describe diagrams, arrows, graphs, and circled or highlighted regions when they carry meaning. Do not summarize or omit repeated-looking details. If a word is uncertain, write [unclear]. Return only the transcription.`
              : `Extract all text from ${label} verbatim. Preserve headings, equations, bullets, layout cues, and line breaks. Return only the extracted text.`,
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function getPdfScreenshotPages(
  buffer: Buffer,
): Promise<PdfScreenshotPage[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const screenshots = await parser.getScreenshot({
      desiredWidth: 1400,
      imageBuffer: false,
      imageDataUrl: true,
    });

    return screenshots.pages
      .map((page) => ({ pageNumber: page.pageNumber, dataUrl: page.dataUrl }))
      .filter(
        (page) => Number.isFinite(page.pageNumber) && Boolean(page.dataUrl),
      )
      .sort((a, b) => a.pageNumber - b.pageNumber);
  } finally {
    await parser.destroy();
  }
}

async function transcribePdfPages(
  client: OpenAI,
  screenshots: PdfScreenshotPage[],
): Promise<DocumentPage[]> {
  const pages: DocumentPage[] = [];

  for (const page of screenshots) {
    const label = `Page ${page.pageNumber}`;
    pages.push({
      label,
      text: await transcribePageImage({
        client,
        dataUrl: page.dataUrl,
        label,
        isHandwriting: true,
      }),
    });
  }

  return pages;
}

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  return stripXml(entry.getData().toString("utf8"));
}

function extractPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  return slides
    .map((e) => stripXml(e.getData().toString("utf8")))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function extractXlsxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const ssEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (ssEntry) {
    const xml = ssEntry.getData().toString("utf8");
    for (const m of xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g))
      sharedStrings.push(m[1]);
  }

  const sheets = zip
    .getEntries()
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName));
  const rows: string[] = [];

  for (const sheet of sheets) {
    const xml = sheet.getData().toString("utf8");
    for (const rowM of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rowM[1].matchAll(
        /<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>/g,
      ))
        cells.push(sharedStrings[parseInt(cm[1])] ?? "");
      for (const cm of rowM[1].matchAll(
        /<c(?![^>]*t="s")[^>]*>[\s\S]*?<v>([^<]+)<\/v>/g,
      ))
        cells.push(cm[1]);
      if (cells.length) rows.push(cells.join("\t"));
    }
  }
  return rows.join("\n");
}

function extractZipText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const textExts = new Set([
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".js",
    ".ts",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".css",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".sql",
    ".sh",
    ".bat",
  ]);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (textExts.has(path.extname(entry.entryName).toLowerCase())) {
      parts.push(
        `=== ${entry.entryName} ===\n${entry.getData().toString("utf8")}`,
      );
    }
  }
  return parts.join("\n\n") || "(No readable text files found in archive)";
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const formData = await request.formData();

    const file = formData.get("file");
    const clusterSlug = formData.get("clusterSlug");
    const sourceLabel = formData.get("sourceLabel");
    const isHandwriting = formData.get("isHandwriting") === "true";
    const generateMap = formData.get("generateMap") !== "false"; // default true

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (typeof clusterSlug !== "string" || !clusterSlug.trim()) {
      return NextResponse.json(
        { error: "clusterSlug is required" },
        { status: 400 },
      );
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH is not configured" },
        { status: 500 },
      );
    }
    const normalizedClusterSlug = cluster.slug;
    const filename = file.name;
    const ext = path.extname(filename).toLowerCase().replace(".", "");
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    const source =
      typeof sourceLabel === "string" && sourceLabel.trim()
        ? sourceLabel.trim()
        : "upload";
    const client = createChatmockClient(baseURL);

    // ── Text extraction ──────────────────────────────────────────────────────

    let markdownText: string;
    let plainText: string;
    let pages: DocumentPage[] = [];
    let screenshotWarning = "";
    let sourcePdfPath: string | undefined;

    if (isImageExt(ext)) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `${mimeToBase64Prefix(file.type, ext)}${base64}`;

      plainText = await transcribePageImage({
        client,
        dataUrl,
        label: "Image",
        isHandwriting,
      });
      const imagePath = saveDataUrlAsset({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        baseName: nameWithoutExt,
        label: "image",
        dataUrl,
      });
      pages = [
        {
          label: "Image",
          text: plainText,
          imagePath,
          imageAlt: nameWithoutExt,
        },
      ];
      markdownText = pageMarkdown(pages);
    } else if (ext === "pdf") {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      sourcePdfPath = saveUploadedPdfAsset({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        baseName: nameWithoutExt,
        buffer,
      });
      let screenshots: PdfScreenshotPage[] = [];
      try {
        screenshots = await getPdfScreenshotPages(buffer);
      } catch (error) {
        screenshotWarning =
          error instanceof Error
            ? `PDF screenshot capture failed: ${error.message}`
            : "PDF screenshot capture failed.";
        screenshots = [];
      }

      if (isHandwriting) {
        if (screenshots.length > 0) {
          pages = await transcribePdfPages(client, screenshots);
          pages = attachPdfScreenshotAssets({
            pages,
            screenshots,
            contentPath,
            clusterSlug: normalizedClusterSlug,
            sourceTitle: nameWithoutExt,
          });
        } else {
          const parser = new PDFParse({ data: buffer });
          const result = await parser.getText({ pageJoiner: "\n\n" });
          await parser.destroy();
          pages = result.pages.map((page) => ({
            label: `Page ${page.num}`,
            text: page.text,
          }));
        }
        plainText = pagePlainText(pages);
        markdownText = pageMarkdown(pages);
      } else {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText({ pageJoiner: "\n\n" });
        await parser.destroy();

        plainText = result.text;
        pages = result.pages.map((page) => ({
          label: `Page ${page.num}`,
          text: page.text,
        }));
        pages = attachPdfScreenshotAssets({
          pages,
          screenshots,
          contentPath,
          clusterSlug: normalizedClusterSlug,
          sourceTitle: nameWithoutExt,
        });

        const mdResponse = await client.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Convert raw PDF-extracted text into well-structured Markdown. " +
                "Preserve all content. Add headers, bullet lists, bold for key terms. " +
                "Clean up PDF artifacts. Return only Markdown, no commentary.",
            },
            {
              role: "user",
              content: `Convert this to Markdown:\n\n${plainText}`,
            },
          ],
        });

        markdownText = appendSnapshots(
          mdResponse.choices[0]?.message?.content ?? plainText,
          pages,
        );
      }
      if (screenshots.length === 0 && !screenshotWarning) {
        screenshotWarning = "No page screenshots were returned for this PDF.";
      }
    } else if (ext === "csv") {
      plainText = await file.text();
      markdownText = "```csv\n" + plainText + "\n```";
      pages = [{ label: "CSV Data", text: plainText }];
    } else if (ext === "docx") {
      const buffer = Buffer.from(await file.arrayBuffer());
      plainText = extractDocxText(buffer);
      markdownText = plainText;
      pages = [{ label: "Word Document", text: plainText }];
    } else if (ext === "pptx") {
      const buffer = Buffer.from(await file.arrayBuffer());
      plainText = extractPptxText(buffer);
      markdownText = plainText;
      pages = plainText
        .split("\n\n---\n\n")
        .map((t, i) => ({ label: `Slide ${i + 1}`, text: t }));
    } else if (ext === "xlsx") {
      const buffer = Buffer.from(await file.arrayBuffer());
      plainText = extractXlsxText(buffer);
      markdownText = "```\n" + plainText + "\n```";
      pages = [{ label: "Excel Data", text: plainText }];
    } else if (ext === "zip") {
      const buffer = Buffer.from(await file.arrayBuffer());
      plainText = extractZipText(buffer);
      markdownText = plainText;
      pages = [{ label: "Archive Contents", text: plainText }];
    } else {
      plainText = await file.text();
      markdownText = plainText;
      pages = [{ label: ext === "md" ? "Markdown" : "Text", text: plainText }];
    }

    // ── Knowledge extraction (optional) ──────────────────────────────────────

    let extraction: KnowledgeExtraction;
    if (generateMap) {
      extraction = await extractDocumentKnowledge({
        client,
        title: nameWithoutExt,
        sourceType: ext || "text",
        sourceLabel: source,
        isHandwriting,
        pages,
        text: plainText,
      });
    } else {
      extraction = {
        documentTitle: nameWithoutExt,
        summary: plainText.slice(0, 300),
        topics: [],
        relationships: [],
        suggestedTags: [],
      };
    }

    const saved = await writeDocumentKnowledge({
      client,
      contentPath,
      clusterSlug: normalizedClusterSlug,
      sourceTitle: nameWithoutExt,
      sourceFileName: filename,
      sourceType: ext || "text",
      sourceLabel: source,
      sourcePdfPath,
      isHandwriting,
      markdownText,
      plainText,
      pages,
      extraction,
    });
    const imageCount = pages.filter((page) => page.imagePath).length;

    return NextResponse.json({
      success: true,
      filename,
      slug: saved.sourceSlug,
      wordCount: saved.wordCount,
      topicCount: saved.topics.length,
      imageCount,
      screenshotWarning: screenshotWarning || undefined,
      topics: saved.topics,
    });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
