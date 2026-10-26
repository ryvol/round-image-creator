import { MAX_SOURCE_SIDE } from './env';
import type { Source } from './render';

const SVG_RASTER_SIZE = 2048;

/** Shrinks very large photos (e.g. 48 MP phone cameras) to stay within memory/canvas limits. */
function limitSize(image: CanvasImageSource, w: number, h: number): Source {
  const k = MAX_SOURCE_SIDE / Math.max(w, h);
  if (k >= 1) return { image, width: w, height: h };
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, c.width, c.height);
  if (image instanceof ImageBitmap) image.close();
  return { image: c, width: c.width, height: c.height };
}

export async function decodeImage(file: Blob): Promise<Source> {
  const isSvg = file.type === 'image/svg+xml';
  if (!isSvg) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return limitSize(bmp, bmp.width, bmp.height);
    } catch {
      // Fall through to the <img> decoder, which supports more formats in some browsers.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || SVG_RASTER_SIZE;
    let h = img.naturalHeight || SVG_RASTER_SIZE;
    // Vector images: rasterize at a high resolution so large outputs stay sharp.
    const k = isSvg
      ? Math.min(SVG_RASTER_SIZE, MAX_SOURCE_SIDE) / Math.max(w, h)
      : Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h));
    w = Math.round(w * k);
    h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return { image: c, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function releaseSource(src: Source) {
  if (src.image instanceof ImageBitmap) src.image.close();
}
