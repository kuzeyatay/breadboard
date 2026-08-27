declare module "svg-to-pdfkit" {
  interface SvgToPdfOptions {
    width?: number;
    height?: number;
    assumePt?: boolean;
    preserveAspectRatio?: string;
  }

  export default function svgToPdf(
    document: PDFKit.PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: SvgToPdfOptions,
  ): void;
}
