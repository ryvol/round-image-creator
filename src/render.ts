export const LINE_STYLES = ['solid', 'dashed', 'long-dash', 'dotted', 'dash-dot'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

export interface InnerCircle {
  visible: boolean;
  /** Outer edge diameter of the inner circle, in output px. */
  diameter: number;
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** 0..1 fill opacity using `color`. */
  fillOpacity: number;
}

export interface RenderOptions {
  /** Output diameter in px. */
  size: number;
  /** 1 = image just covers the circle; < 1 shrinks it inside the circle, > 1 zooms in. */
  zoom: number;
  /** Pan offset as a fraction of `size`. */
  panX: number;
  panY: number;
  /** CSS color filling the circle behind the image, or null for transparent. */
  background: string | null;
  inner: InnerCircle | null;
}

export interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Returns the dash pattern and line cap for a style. The pattern is stretched slightly so a
 * whole number of repeats fits the circumference, which avoids a broken segment where the
 * path closes.
 */
export function linePattern(style: LineStyle, lw: number, circumference: number) {
  const dash = Math.max(lw * 3, 6);
  const gap = Math.max(lw * 2, 4);
  let pattern: number[];
  let cap: CanvasLineCap = 'butt';
  switch (style) {
    case 'solid':
      return { pattern: [] as number[], cap };
    case 'dashed':
      pattern = [dash, gap];
      break;
    case 'long-dash':
      pattern = [Math.max(lw * 8, 16), Math.max(lw * 3, 6)];
      break;
    case 'dotted':
      // Zero-length dashes with round caps render as round dots of diameter `lw`.
      pattern = [0, Math.max(lw * 2, 3)];
      cap = 'round';
      break;
    case 'dash-dot':
      pattern = [Math.max(lw * 4, 8), gap, 0, gap];
      cap = 'round';
      break;
  }
  const len = pattern.reduce((a, b) => a + b, 0);
  const repeats = Math.max(1, Math.round(circumference / len));
  const k = circumference / (repeats * len);
  return { pattern: pattern.map((v) => v * k), cap };
}

export function coverScale(src: Source, size: number, zoom: number): number {
  return Math.max(size / src.width, size / src.height) * zoom;
}

/** Zoom at which the whole image fits inside the circle (its diagonal equals the diameter). */
export function fitZoom(src: Source, size: number): number {
  return size / Math.hypot(src.width, src.height) / coverScale(src, size, 1);
}

/** Zoom at which one source pixel maps to one output pixel. */
export function actualSizeZoom(src: Source, size: number): number {
  return 1 / coverScale(src, size, 1);
}

/**
 * Limits the pan so that any point of the image, up to its very edge, can be brought to the
 * circle's center, while the image can never be dragged completely out of view. A small image
 * can additionally move until its edge reaches the circle's bounding box. Values are fractions of `size`.
 */
export function clampPan(src: Source, size: number, zoom: number, panX: number, panY: number) {
  const s = coverScale(src, size, zoom);
  const dw = src.width * s;
  const dh = src.height * s;
  const maxX = Math.max(dw / 2, Math.abs(dw - size) / 2) / size;
  const maxY = Math.max(dh / 2, Math.abs(dh - size) / 2) / size;
  return { x: clamp(panX, -maxX, maxX), y: clamp(panY, -maxY, maxY) };
}

/** Position and size of the whole (uncropped) image in output px coordinates. */
export function imageRect(src: Source, opts: RenderOptions) {
  const { size } = opts;
  const s = coverScale(src, size, opts.zoom);
  const w = src.width * s;
  const h = src.height * s;
  const pan = clampPan(src, size, opts.zoom, opts.panX, opts.panY);
  return { x: (size - w) / 2 + pan.x * size, y: (size - h) / 2 + pan.y * size, w, h };
}

let roundBuffer: HTMLCanvasElement | null = null;

/**
 * Draws the preview. With `margin` > 0 (a fraction of the output size added on each side), the
 * parts of the image cropped away by the circle are shown faded, and the image's outer bounds
 * and the output circle edge are outlined. Only the round output inside is the real result.
 */
export function renderPreview(
  canvas: HTMLCanvasElement,
  src: Source,
  opts: RenderOptions,
  scale: number,
  margin: number,
  dpr = 1,
): void {
  const { size } = opts;
  const m = Math.max(0, margin) * size;
  const view = size + 2 * m;
  const px = Math.max(1, Math.round(view * scale));
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available');
  const k = px / view;

  roundBuffer ??= document.createElement('canvas');
  renderRound(roundBuffer, src, opts, scale);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  if (m === 0) {
    ctx.drawImage(roundBuffer, 0, 0, px, px);
    return;
  }

  const rect = imageRect(src, opts);
  const toPx = (v: number) => (m + v) * k;

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.image, toPx(rect.x), toPx(rect.y), rect.w * k, rect.h * k);
  ctx.restore();

  ctx.drawImage(roundBuffer, m * k, m * k, size * k, size * k);

  const lw = 1.5 * dpr;
  ctx.lineWidth = lw;

  // Output circle edge
  ctx.beginPath();
  ctx.arc(toPx(size / 2), toPx(size / 2), (size / 2) * k, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.8)';
  ctx.setLineDash([]);
  ctx.stroke();

  // Image bounds: alternating dark/light dashes stay visible on any image.
  const x = Math.round(toPx(rect.x)) + lw / 2;
  const y = Math.round(toPx(rect.y)) + lw / 2;
  const w = Math.round(rect.w * k) - lw;
  const h = Math.round(rect.h * k) - lw;
  const dash = 6 * dpr;
  ctx.strokeStyle = '#000';
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([dash, dash]);
  ctx.strokeRect(x, y, w, h);
}

/**
 * Draws the round image into `canvas`. `scale` lets the preview render at a lower
 * resolution than the final output while keeping identical geometry.
 */
export function renderRound(canvas: HTMLCanvasElement, src: Source, opts: RenderOptions, scale = 1): void {
  const { size } = opts;
  const px = Math.max(1, Math.round(size * scale));
  canvas.width = px;
  canvas.height = px;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available');

  const k = px / size;
  const r = size / 2;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const rect = imageRect(src, opts);
  ctx.drawImage(src.image, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  const inner = opts.inner;
  if (inner?.visible && inner.diameter > 0) {
    const d = Math.min(inner.diameter, size);
    const lw = Math.min(Math.max(0, inner.lineWidth), d / 2);
    // Keep the stroke fully inside the requested diameter.
    const ir = Math.max(0, d / 2 - lw / 2);

    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, ir, 0, Math.PI * 2);
    ctx.closePath();
    if (inner.fillOpacity > 0) {
      ctx.globalAlpha = clamp(inner.fillOpacity, 0, 1);
      ctx.fillStyle = inner.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (lw > 0) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = inner.color;
      const { pattern, cap } = linePattern(inner.lineStyle, lw, 2 * Math.PI * ir);
      ctx.lineCap = cap;
      ctx.setLineDash(pattern);
      ctx.stroke();
    }
    ctx.restore();
  }
}
