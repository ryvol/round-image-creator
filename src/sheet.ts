export const PAGE_SIZES = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
} as const satisfies Record<string, readonly [number, number]>;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** All lengths are in millimetres. */
export interface SheetOptions {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  /** Space between neighbouring images. */
  gap: number;
  diameter: number;
  count: number;
  /** Center the images on each page; otherwise start at the top-left margin. */
  center: boolean;
}

export interface SheetLayout {
  cols: number;
  rows: number;
  perPage: number;
  /** Top-left corner of every image's square on each page, measured from the page's top-left. */
  pages: { x: number; y: number }[][];
}

export const MM_TO_PT = 72 / 25.4;

/** Arranges `count` circles in a grid with as many per row/column as fit on each page. */
export function layoutSheet(o: SheetOptions): SheetLayout | { error: string } {
  const availW = o.pageWidth - 2 * o.margin;
  const availH = o.pageHeight - 2 * o.margin;
  if (!(o.diameter > 0)) return { error: 'Image size must be greater than 0 mm.' };
  if (!(o.count >= 1)) return { error: 'Set a print count of at least 1 on a page.' };
  if (availW <= 0 || availH <= 0) return { error: 'Margins are larger than the page.' };

  const step = o.diameter + o.gap;
  // A tiny epsilon keeps exact fits (e.g. 190 mm for 4 × 45 mm + 3 × 5 mm) from being lost to rounding.
  const cols = Math.floor((availW + o.gap + 1e-9) / step);
  const rows = Math.floor((availH + o.gap + 1e-9) / step);
  if (cols < 1 || rows < 1) {
    const max = Math.min(availW, availH);
    return { error: `A ${o.diameter} mm image does not fit on the page (max ${max.toFixed(1)} mm with these margins).` };
  }

  const perPage = cols * rows;
  const pages: SheetLayout['pages'] = [];
  for (let start = 0; start < o.count; start += perPage) {
    const n = Math.min(perPage, o.count - start);
    const usedCols = Math.min(cols, n);
    const usedRows = Math.ceil(n / cols);
    const blockW = usedCols * o.diameter + (usedCols - 1) * o.gap;
    const blockH = usedRows * o.diameter + (usedRows - 1) * o.gap;
    const x0 = o.center ? o.margin + (availW - blockW) / 2 : o.margin;
    const y0 = o.center ? o.margin + (availH - blockH) / 2 : o.margin;
    const page: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      page.push({ x: x0 + (i % cols) * step, y: y0 + Math.floor(i / cols) * step });
    }
    pages.push(page);
  }
  return { cols, rows, perPage, pages };
}

export interface PdfOptions {
  sheet: SheetOptions;
  layout: SheetLayout;
  /** PNG bytes of each distinct round image. */
  images: ArrayBuffer[];
  /** Index into `images` for every grid slot, in layout order (length = sheet.count). */
  sequence: number[];
  cutLines: boolean;
  title: string;
}

export async function buildPdf(o: PdfOptions): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(o.title);
  doc.setCreator('Round Image Maker');
  // Each image is embedded once and referenced by every placement, so the file stays small.
  const embedded = await Promise.all(o.images.map((png) => doc.embedPng(png)));

  const pw = o.sheet.pageWidth * MM_TO_PT;
  const ph = o.sheet.pageHeight * MM_TO_PT;
  const d = o.sheet.diameter * MM_TO_PT;

  let slot = 0;
  for (const positions of o.layout.pages) {
    const page = doc.addPage([pw, ph]);
    for (const p of positions) {
      const image = embedded[o.sequence[slot++]];
      const x = p.x * MM_TO_PT;
      // PDF origin is bottom-left.
      const y = ph - p.y * MM_TO_PT - d;
      page.drawImage(image, { x, y, width: d, height: d });
      if (o.cutLines) {
        page.drawCircle({
          x: x + d / 2,
          y: y + d / 2,
          size: d / 2,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 0.25,
        });
      }
    }
  }
  return doc.save();
}
