import { generateHandwriting, validateHandwritingFont } from './handwrite';

self.onmessage = async (event: MessageEvent<{ file?: File; pixels?: { width: number; height: number; data: Uint8ClampedArray }; font?: ArrayBuffer }>) => {
  try {
    let pixels = event.data.pixels;
    if (event.data.file) {
      const file = event.data.file;
      if (file.size > 12 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Upload a JPG or PNG scan, up to 12 MB.');
      const bitmap = await createImageBitmap(file, { resizeHeight: 2400, resizeQuality: 'high', imageOrientation: 'from-image' });
      try {
        if (bitmap.width > 2500 || bitmap.width < 640) throw new Error('Use an upright portrait scan of the complete template.');
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
        context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      } finally { bitmap.close(); }
    }
    const font = event.data.font ? validateHandwritingFont(event.data.font) : await generateHandwriting(pixels!, value => self.postMessage({ progress: value }));
    self.postMessage({ font }, { transfer: [font] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this handwriting sample.' }); }
};
