/** Prepare a local photo for the appearance preferences, without sending it anywhere. */
export const WALLPAPER_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2560;
const MAX_DATA_URL_LENGTH = 400_000;

export async function prepareWallpaperUpload(file: File): Promise<string> {
  const supported = /^image\/(jpeg|png|webp|avif)$/i.test(file.type)
    || (!file.type && /\.(jpe?g|png|webp|avif)$/i.test(file.name));
  if (!supported) throw new Error("Choose a JPG, PNG, WebP, or AVIF image.");
  if (file.size === 0) throw new Error("That image is empty. Choose another file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an image smaller than 20 MB.");

  const image = new Image();
  const source = URL.createObjectURL(file);
  try {
    image.src = source;
    try {
      await image.decode();
    } catch {
      throw new Error("Couldn’t open that image. Try another JPG, PNG, WebP, or AVIF file.");
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn’t prepare that image. Try again.");
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));

    // Bound the saved size as well as the dimensions: six page/theme choices
    // should leave room for the app's other local preferences.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      const result = canvas.toDataURL("image/webp", 0.85);
      if (result.startsWith("data:image/") && result.length <= MAX_DATA_URL_LENGTH) return result;
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error("That image is too large to save. Try a smaller image.");
  } finally {
    URL.revokeObjectURL(source);
  }
}
