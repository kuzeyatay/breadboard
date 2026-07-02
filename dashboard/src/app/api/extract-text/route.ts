import { NextResponse } from 'next/server';
import path from 'path';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import type OpenAI from 'openai';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { DEFAULT_MODEL, createChatmockClient } from '@/lib/knowledge';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isUsageLimitError(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = errorMessage(error, '').toLowerCase();
  return (
    status === 429 ||
    message.includes('usage limit') ||
    message.includes('rate limit') ||
    message.includes('quota')
  );
}

function mimeToBase64Prefix(mimeType: string): string {
  if (mimeType === 'image/png') return 'data:image/png;base64,';
  if (mimeType === 'image/webp') return 'data:image/webp;base64,';
  return 'data:image/jpeg;base64,';
}

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return '';
  return stripXml(entry.getData().toString('utf8'));
}

function extractPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((e) => stripXml(e.getData().toString('utf8')))
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function extractXlsxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const sharedStrings: string[] = [];
  const ssEntry = zip.getEntry('xl/sharedStrings.xml');
  if (ssEntry) {
    for (const m of ssEntry.getData().toString('utf8').matchAll(/<t[^>]*>([^<]*)<\/t>/g))
      sharedStrings.push(m[1]);
  }
  const rows: string[] = [];
  for (const sheet of zip.getEntries().filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))) {
    for (const rowM of sheet.getData().toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rowM[1].matchAll(/<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>/g))
        cells.push(sharedStrings[parseInt(cm[1])] ?? '');
      for (const cm of rowM[1].matchAll(/<c(?![^>]*t="s")[^>]*>[\s\S]*?<v>([^<]+)<\/v>/g))
        cells.push(cm[1]);
      if (cells.length) rows.push(cells.join('\t'));
    }
  }
  return rows.join('\n');
}

function extractZipText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const textExts = new Set([
    '.txt', '.md', '.csv', '.json', '.xml', '.html', '.js', '.ts',
    '.py', '.java', '.c', '.cpp', '.h', '.css', '.yaml', '.yml',
    '.toml', '.ini', '.sql', '.sh', '.bat',
  ]);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (textExts.has(path.extname(entry.entryName).toLowerCase()))
      parts.push(`=== ${entry.entryName} ===\n${entry.getData().toString('utf8')}`);
  }
  return parts.join('\n\n') || '(No readable text files found in archive)';
}

async function getPdfScreenshotPages(buffer: Buffer): Promise<Array<{ pageNumber: number; dataUrl: string }>> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pages: Array<{ pageNumber: number; dataUrl: string }> = [];

    for (let first = 1; first <= info.total; first += 4) {
      const last = Math.min(first + 3, info.total);
      const screenshots = await parser.getScreenshot({
        first,
        last,
        desiredWidth: 1200,
        imageBuffer: false,
        imageDataUrl: true,
      });

      pages.push(
        ...screenshots.pages
          .map((page) => ({ pageNumber: page.pageNumber, dataUrl: page.dataUrl }))
          .filter((page) => Number.isFinite(page.pageNumber) && Boolean(page.dataUrl)),
      );
    }

    return pages.sort((left, right) => left.pageNumber - right.pageNumber);
  } finally {
    await parser.destroy();
  }
}

async function extractPdfText(buffer: Buffer): Promise<{ text: string; warning: string }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pages: Array<{ pageNumber: number; text: string }> = [];
    const warnings: string[] = [];

    const readRange = async (first: number, last: number): Promise<void> => {
      try {
        const result = await parser.getText({ first, last, pageJoiner: '\n\n' });
        pages.push(
          ...result.pages.map((page) => ({
            pageNumber: page.num,
            text: page.text,
          })),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'PDF text extraction failed';
        if (first < last) {
          const middle = Math.floor((first + last) / 2);
          await readRange(first, middle);
          await readRange(middle + 1, last);
          return;
        }

        warnings.push(`Page ${first}: ${reason}`);
        pages.push({
          pageNumber: first,
          text: `[PDF text extraction failed for Page ${first}: ${reason}]`,
        });
      }
    };

    for (let first = 1; first <= info.total; first += 12) {
      const last = Math.min(first + 11, info.total);
      await readRange(first, last);
    }

    pages.sort((left, right) => left.pageNumber - right.pageNumber);

    return {
      text: pages
        .map((page) => `[[Page ${page.pageNumber}]]\n${page.text}`)
        .join('\n\n'),
      warning:
        warnings.length > 0
          ? `PDF text extraction failed for ${warnings.length} page${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`
          : '',
    };
  } finally {
    await parser.destroy();
  }
}

async function transcribeImage(
  client: OpenAI,
  dataUrl: string,
  label: string,
): Promise<string> {
  const response = await client.chat.completions.create(withCouncil({
    model: DEFAULT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        {
          type: 'text',
          text:
            `Transcribe ${label} from a handwritten or scanned document. ` +
            'Preserve headings, equations, bullets, labels, worked examples, tables, and line breaks. ' +
            'Describe meaningful diagrams or arrows. If a word is uncertain, write [unclear]. Return only the transcription.',
        },
      ],
    }],
  }, { taskType: 'ocr' }));
  return response.choices[0]?.message?.content?.trim() ?? '';
}

async function transcribePdf(
  client: OpenAI,
  buffer: Buffer,
): Promise<{ text: string; warning: string }> {
  let pages: Array<{ pageNumber: number; dataUrl: string }> = [];
  try {
    pages = await getPdfScreenshotPages(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'PDF screenshot capture failed';
    const fallback = await extractPdfText(buffer);
    return {
      text: fallback.text,
      warning:
        `Handwriting OCR screenshot capture failed: ${reason}. Used embedded PDF text instead.` +
        (fallback.warning ? ` ${fallback.warning}` : ''),
    };
  }

  if (pages.length === 0) {
    const fallback = await extractPdfText(buffer);
    return {
      text: fallback.text,
      warning:
        'No page screenshots were returned for handwriting OCR. Used embedded PDF text instead.' +
        (fallback.warning ? ` ${fallback.warning}` : ''),
    };
  }

  const text = new Array<string>(pages.length);
  const warnings: string[] = [];
  let usageLimitReason = '';
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < pages.length && !usageLimitReason) {
      const index = nextIndex;
      nextIndex += 1;
      const page = pages[index];
      const label = `Page ${page.pageNumber}`;
      try {
        text[index] = `[[${label}]]\n${await transcribeImage(client, page.dataUrl, label)}`;
      } catch (error) {
        const reason = errorMessage(error, 'vision OCR failed');
        if (isUsageLimitError(error)) {
          usageLimitReason = reason;
          return;
        }
        warnings.push(`${label}: ${reason}`);
        text[index] = `[[${label}]]\n[OCR failed for ${label}: ${reason}]`;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, pages.length) }, () => worker()));

  if (usageLimitReason) {
    return {
      text: '',
      warning: `Handwriting OCR could not run because the AI usage limit was reached: ${usageLimitReason}`,
    };
  }

  return {
    text: text.filter(Boolean).join('\n\n'),
    warning:
      warnings.length > 0
        ? `Handwriting OCR failed for ${warnings.length} page${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`
        : '',
  };
}

// Returns { type: 'text', text } or { type: 'image', dataUrl, mimeType }
export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    await requireUserId();
    const formData = await request.formData();
    const file = formData.get('file');
    const isHandwriting = formData.get('isHandwriting') === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase().replace('.', '');

    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      // For images, return base64 so the chat can send it as a vision message
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = file.type || 'image/jpeg';
      const dataUrl = `${mimeToBase64Prefix(mimeType)}${base64}`;

      if (isHandwriting) {
        // OCR via vision model
        const client = createChatmockClient(baseURL);
        const text = await transcribeImage(client, dataUrl, 'Image');
        return NextResponse.json({ type: 'text', text, name: file.name });
      }

      return NextResponse.json({ type: 'image', dataUrl, mimeType, name: file.name });
    }

    let text = '';

    if (ext === 'pdf') {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (isHandwriting) {
        const client = createChatmockClient(baseURL);
        const result = await transcribePdf(client, buffer);
        return NextResponse.json({ type: 'text', text: result.text, warning: result.warning, name: file.name });
      } else {
        const result = await extractPdfText(buffer);
        text = result.text;
        if (result.warning) {
          return NextResponse.json({ type: 'text', text, warning: result.warning, name: file.name });
        }
      }
    } else if (ext === 'docx') {
      text = extractDocxText(Buffer.from(await file.arrayBuffer()));
    } else if (ext === 'pptx') {
      text = extractPptxText(Buffer.from(await file.arrayBuffer()));
    } else if (ext === 'xlsx') {
      text = extractXlsxText(Buffer.from(await file.arrayBuffer()));
    } else if (ext === 'zip') {
      text = extractZipText(Buffer.from(await file.arrayBuffer()));
    } else {
      text = await file.text();
    }

    return NextResponse.json({ type: 'text', text, name: file.name });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
