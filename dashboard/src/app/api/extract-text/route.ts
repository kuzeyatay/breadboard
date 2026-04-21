import { NextResponse } from 'next/server';
import path from 'path';
import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { DEFAULT_MODEL, createChatmockClient } from '@/lib/knowledge';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

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
        const response = await client.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: 'Transcribe all handwritten text exactly, preserving structure.' },
            ],
          }],
        });
        return NextResponse.json({ type: 'text', text: response.choices[0]?.message?.content ?? '', name: file.name });
      }

      return NextResponse.json({ type: 'image', dataUrl, mimeType, name: file.name });
    }

    let text = '';

    if (ext === 'pdf') {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText({ pageJoiner: '\n\n' });
      await parser.destroy();
      text = result.text;
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
