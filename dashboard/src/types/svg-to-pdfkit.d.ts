declare module "svg-to-pdfkit" {
  /**
   * Renders an SVG string into a PDFKit document at the given position.
   * `svg-to-pdfkit` ships no type declarations, so this minimal shim covers
   * the call surface used by the markdown-to-pdf route.
   */
  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: Record<string, unknown>,
  ): void;
  export default SVGtoPDF;
}
