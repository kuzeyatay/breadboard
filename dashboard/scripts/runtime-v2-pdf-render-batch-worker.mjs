import fs from "node:fs";
import { PDFParse } from "pdf-parse";

const [, , sourceFilePath, firstRaw, lastRaw, desiredWidthRaw] = process.argv;
const first = Number(firstRaw);
const last = Number(lastRaw);
const desiredWidth = Number(desiredWidthRaw);

if (
  !sourceFilePath ||
  !Number.isSafeInteger(first) ||
  first < 1 ||
  !Number.isSafeInteger(last) ||
  last < first ||
  last - first > 15 ||
  !Number.isSafeInteger(desiredWidth) ||
  desiredWidth < 64 ||
  desiredWidth > 4096
) {
  throw new TypeError("The isolated PDF render request is invalid.");
}

const bytes = fs.readFileSync(sourceFilePath);
const parser = new PDFParse({ data: bytes });
try {
  const info = await parser.getInfo();
  if (last > info.total) {
    throw new RangeError("The isolated PDF render range exceeds the document.");
  }
  const rendered = await parser.getScreenshot({
    first,
    last,
    desiredWidth,
    imageBuffer: false,
    imageDataUrl: true,
  });
  const pages = rendered.pages
    .map((page) => ({ pageNumber: page.pageNumber, dataUrl: page.dataUrl }))
    .filter((page) => Number.isSafeInteger(page.pageNumber) && page.dataUrl)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  process.stdout.write(JSON.stringify(pages));
} finally {
  await parser.destroy();
}
