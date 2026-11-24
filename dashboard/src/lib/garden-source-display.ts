/** Filename identity is separate from the AI description of an uploaded source. */
export function isPptxSource(sourceType: string, sourceFile: string): boolean {
  return sourceType.trim().toLowerCase() === "pptx" || /\.pptx$/i.test(sourceFile.trim());
}

export function gardenSourceDisplay(source: {
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  title: string;
  description: string;
  name: string;
}) {
  const filenameFirst = source.sourceType.trim().toLowerCase() === "pdf" ||
    /\.pdf$/i.test(source.sourceFile.trim()) || isPptxSource(source.sourceType, source.sourceFile);
  const title = (filenameFirst ? source.sourceFile.trim() : "") || source.title || source.name;
  const description = source.description.trim();
  // A name that only repeats the file name without its extension says nothing new.
  const same = (value: string) => value === title || value === title.replace(/\.[a-z0-9]{2,5}$/i, "");
  return {
    title,
    description: (!same(description) ? description : "") ||
      (filenameFirst && !same(source.title.trim()) ? source.title.trim() : ""),
    hasPdf: Boolean(source.sourcePdf.trim()),
  };
}

/** The viewer keeps the upload's title; exported PDF bytes need a PDF extension. */
export function sourcePdfFileName(filename: string): string {
  return filename.trim().replace(/\.pptx$/i, ".pdf");
}
