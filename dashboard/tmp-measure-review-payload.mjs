// Measures what one source-formula-review request actually carries, using the
// same renderer and the same crop geometry the pipeline uses. Read-only.
import fs from "node:fs";
import { PDFParse } from "pdf-parse";
import { cropPng, resizePngToMaxDimension } from "@/lib/png-crop";

const pdfPath =
  "C:/Users/20252082/breadboard/quartz/content/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-source.pdf";
const pageNumber = Number(process.argv[2] ?? 398);

const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
try {
  const shot = await parser.getScreenshot({
    partial: [pageNumber],
    desiredWidth: 1600,
    imageBuffer: true,
    imageDataUrl: false,
  });
  const png = Buffer.from(shot.pages.find((p) => p.pageNumber === pageNumber).data);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const base64Chars = png.toString("base64").length;

  // Equation crop floor from expandedCropBBox: 0.5 wide by 0.075 tall.
  const crop = cropPng(png, { x: 0.25, y: 0.4, width: 0.5, height: 0.075 });
  const cropB64 = crop.toString("base64").length;

  console.log(
    JSON.stringify(
      {
        page: pageNumber,
        pagePixels: `${width}x${height}`,
        pagePngKB: Math.round(png.length / 1024),
        pageBase64Chars: base64Chars,
        pageTokensIfNativeImage: Math.round((width * height) / 750),
        pageTokensIfBase64Text: Math.round(base64Chars / 3.5),
        smallestEquationCropPngKB: Math.round(crop.length / 1024),
        smallestEquationCropBase64Chars: cropB64,
        cropTokensIfBase64Text: Math.round(cropB64 / 3.5),
        detectionStageWidthCap: resizePngToMaxDimension(png, 768) ? 768 : "unchanged",
      },
      null,
      1,
    ),
  );
} finally {
  await parser.destroy();
}
