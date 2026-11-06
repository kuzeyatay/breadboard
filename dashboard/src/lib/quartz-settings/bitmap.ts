/** Minimal in-memory image adapter for Potrace; decoding belongs to the browser. */
export default class BitmapImage {
  constructor(public bitmap: { width: number; height: number; data: Uint8ClampedArray }) {}
  scan(x: number, y: number, width: number, height: number, callback: (x: number, y: number, index: number) => void) {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      callback(col, row, (row * this.bitmap.width + col) * 4);
    }
  }
  static read() { throw new Error('Only decoded handwriting pixels are accepted.'); }
}
