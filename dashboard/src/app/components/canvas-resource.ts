/** Release a canvas' native pixel backing store at its ownership boundary. */
export function releaseCanvasPixels(
  canvas: Pick<HTMLCanvasElement, "width" | "height"> | null,
): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
