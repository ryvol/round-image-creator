import './style.css';
import { decodeImage, releaseSource } from './decode';
import { MAX_CANVAS_SIDE } from './env';
import { CAN_SHARE_FILES, canvasToBlob, saveBlob, shareOrSave } from './files';
import {
  actualSizeZoom,
  clampPan,
  coverScale,
  fitZoom,
  LINE_STYLES,
  renderPreview,
  renderRound,
  type InnerCircle,
  type LineStyle,
  type RenderOptions,
  type Source,
} from './render';
import { buildPdf, layoutSheet, PAGE_SIZES, type PageSizeName, type SheetOptions } from './sheet';

const MIN_SIZE = 16;
const MAX_SIZE = MAX_CANVAS_SIDE;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const PREVIEW_MARGIN = 0.25;
const MAX_SHEET_IMAGE_PX = MAX_CANVAS_SIDE;
const MAX_COUNT = 1000;
/** CSS size of the page thumbnails; keep in sync with `.page-thumb` in style.css. */
const THUMB_CSS = 72;

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const fileInput = $<HTMLInputElement>('file-input');
const dropzone = $<HTMLLabelElement>('dropzone');
const pageList = $<HTMLDivElement>('page-list');
const pagesCount = $<HTMLSpanElement>('pages-count');
const pagesStatus = $<HTMLSpanElement>('pages-status');
const errorBox = $<HTMLParagraphElement>('error');
const pageInfo = $<HTMLParagraphElement>('page-info');
const positionFieldset = $<HTMLFieldSetElement>('position-fieldset');
const backgroundFieldset = $<HTMLFieldSetElement>('background-fieldset');
const sizeRange = $<HTMLInputElement>('size-range');
const sizeNum = $<HTMLInputElement>('size-num');
const formatSel = $<HTMLSelectElement>('format');
const zoomRange = $<HTMLInputElement>('zoom');
const zoomNum = $<HTMLInputElement>('zoom-num');
const zoomFill = $<HTMLButtonElement>('zoom-fill');
const zoomFit = $<HTMLButtonElement>('zoom-fit');
const zoomActual = $<HTMLButtonElement>('zoom-actual');
const centerPos = $<HTMLButtonElement>('center-pos');
const showBounds = $<HTMLInputElement>('show-bounds');
const bgRadios = document.querySelectorAll<HTMLInputElement>('input[name="bg"]');
const bgColor = $<HTMLInputElement>('bg-color');
const innerVisible = $<HTMLInputElement>('inner-visible');
const innerControls = $<HTMLDivElement>('inner-controls');
const innerRange = $<HTMLInputElement>('inner-range');
const innerNum = $<HTMLInputElement>('inner-num');
const innerPctRange = $<HTMLInputElement>('inner-pct-range');
const innerPct = $<HTMLInputElement>('inner-pct');
const innerColor = $<HTMLInputElement>('inner-color');
const innerWidthRange = $<HTMLInputElement>('inner-width-range');
const innerWidth = $<HTMLInputElement>('inner-width');
const innerStyle = $<HTMLSelectElement>('inner-style');
const innerFill = $<HTMLInputElement>('inner-fill');
const innerFillOut = $<HTMLOutputElement>('inner-fill-out');
const innerExport = $<HTMLInputElement>('inner-export');
const downloadBtn = $<HTMLButtonElement>('download');
const shareBtn = $<HTMLButtonElement>('share');
const canvas = $<HTMLCanvasElement>('preview');
const placeholder = $<HTMLDivElement>('placeholder');
const previewInfo = $<HTMLParagraphElement>('preview-info');
const sheetFieldset = $<HTMLFieldSetElement>('sheet-fieldset');
const sheetAllCount = $<HTMLInputElement>('sheet-all-count');
const sheetAllApply = $<HTMLButtonElement>('sheet-all-apply');
const sheetDiameter = $<HTMLInputElement>('sheet-diameter');
const sheetPage = $<HTMLSelectElement>('sheet-page');
const sheetCustom = $<HTMLDivElement>('sheet-custom');
const sheetWidth = $<HTMLInputElement>('sheet-width');
const sheetHeight = $<HTMLInputElement>('sheet-height');
const sheetOrientation = $<HTMLSelectElement>('sheet-orientation');
const sheetMargin = $<HTMLInputElement>('sheet-margin');
const sheetGap = $<HTMLInputElement>('sheet-gap');
const sheetDpi = $<HTMLSelectElement>('sheet-dpi');
const sheetCenter = $<HTMLInputElement>('sheet-center');
const sheetCutLines = $<HTMLInputElement>('sheet-cutlines');
const sheetSummary = $<HTMLParagraphElement>('sheet-summary');
const sheetPreview = $<HTMLCanvasElement>('sheet-preview');
const downloadPdfBtn = $<HTMLButtonElement>('download-pdf');
const sharePdfBtn = $<HTMLButtonElement>('share-pdf');
sizeNum.max = String(MAX_SIZE);
shareBtn.hidden = !CAN_SHARE_FILES;
sharePdfBtn.hidden = !CAN_SHARE_FILES;

// ---------- Project model ----------

/** One input image with its own position/background and print count. */
interface Page {
  id: number;
  source: Source;
  /** File name without extension, used for downloads. */
  name: string;
  fileName: string;
  zoom: number;
  panX: number;
  panY: number;
  bgMode: 'transparent' | 'color';
  bgColor: string;
  /** Copies in the PDF. */
  count: number;
  card: HTMLDivElement;
  thumb: HTMLCanvasElement;
  num: HTMLSpanElement;
  del: HTMLButtonElement;
  countInput: HTMLInputElement;
}

/** Settings shared by every page. */
const project = {
  size: 512,
  innerRatio: 0.5,
  innerVisible: true,
  innerColor: '#ffffff',
  innerLineWidth: 4,
  innerLineStyle: 'solid' as LineStyle,
  innerFill: 0,
  innerExport: true,
  showBounds: true,
};

const pages: Page[] = [];
let currentId: number | null = null;
let nextId = 1;

const current = () => pages.find((p) => p.id === currentId) ?? null;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const innerDiameter = () => clamp(Math.round(project.innerRatio * project.size), 1, project.size);
/** Margin around the circle in the preview (fraction of the output size per side). */
const previewMargin = () => (project.showBounds ? PREVIEW_MARGIN : 0);
/** Preview canvas width relative to the output diameter. */
const viewFactor = () => 1 + 2 * previewMargin();
const background = (p: Page) => (p.bgMode === 'color' ? p.bgColor : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function innerCircle(): InnerCircle {
  return {
    visible: project.innerVisible,
    diameter: innerDiameter(),
    color: project.innerColor,
    lineWidth: project.innerLineWidth,
    lineStyle: project.innerLineStyle,
    fillOpacity: project.innerFill,
  };
}

function renderOptions(p: Page, includeInner: boolean): RenderOptions {
  return {
    size: project.size,
    zoom: p.zoom,
    panX: p.panX,
    panY: p.panY,
    background: background(p),
    inner: includeInner ? innerCircle() : null,
  };
}

// ---------- Rendering ----------

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function render() {
  const page = current();
  syncControls(page);
  // Thumbnails and the print-sheet preview are skipped during drag/pinch frames (wasted work on phones).
  if (pointers.size === 0) {
    updateSheet();
    scheduleThumbs();
  }
  placeholder.hidden = !!page;
  canvas.hidden = !page;
  downloadBtn.disabled = !page;
  shareBtn.disabled = !page;
  positionFieldset.disabled = !page;
  backgroundFieldset.disabled = !page;
  pagesCount.textContent = pages.length ? `(${pages.length})` : '';

  if (!page) {
    previewInfo.textContent = '';
    pageInfo.textContent = 'Add images to start.';
    return;
  }

  const src = page.source;
  const pan = clampPan(src, project.size, page.zoom, page.panX, page.panY);
  page.panX = pan.x;
  page.panY = pan.y;

  // Render the preview no larger than the on-screen pixels to stay fast for big outputs.
  const cssSize = canvas.clientWidth || canvas.parentElement?.clientWidth || 480;
  const scale = Math.min(1, (cssSize * devicePixelRatio) / (project.size * viewFactor()));
  renderPreview(canvas, src, renderOptions(page, true), scale, previewMargin(), devicePixelRatio);

  pageInfo.textContent = `Page ${pages.indexOf(page) + 1} of ${pages.length} · ${page.fileName} · ${src.width} × ${src.height} px`;
  const inner = project.innerVisible
    ? ` · Inner circle: ${innerDiameter()} px (${(project.innerRatio * 100).toFixed(1)}%)`
    : '';
  const s = coverScale(src, project.size, page.zoom);
  previewInfo.textContent = `Output: ${project.size} × ${project.size} px${inner} · Image in output: ${Math.round(src.width * s)} × ${Math.round(src.height * s)} px`;
}

function setIfIdle(input: HTMLInputElement, value: string) {
  // Don't overwrite a number field while the user is typing in it.
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

function syncControls(page: Page | null) {
  setIfIdle(sizeNum, String(project.size));
  sizeRange.value = String(project.size);

  const zoom = page?.zoom ?? 1;
  zoomRange.value = String(Math.log2(zoom));
  setIfIdle(zoomNum, String(+zoom.toFixed(2)));

  const bgMode = page?.bgMode ?? 'transparent';
  bgRadios.forEach((r) => (r.checked = r.value === bgMode));
  if (page && bgColor.value !== page.bgColor) bgColor.value = page.bgColor;
  bgColor.classList.toggle('inactive', bgMode !== 'color');

  innerRange.max = String(project.size);
  innerNum.max = String(project.size);
  innerRange.value = String(innerDiameter());
  setIfIdle(innerNum, String(innerDiameter()));
  const pct = +(project.innerRatio * 100).toFixed(1);
  innerPctRange.value = String(pct);
  setIfIdle(innerPct, String(pct));
  innerWidthRange.value = String(project.innerLineWidth);
  setIfIdle(innerWidth, String(project.innerLineWidth));
  innerFillOut.value = `${Math.round(project.innerFill * 100)}%`;
  innerControls.classList.toggle('disabled', !project.innerVisible);
  innerControls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
    el.disabled = !project.innerVisible;
  });
}

// ---------- Pages ----------

function showError(msg: string | null) {
  errorBox.hidden = !msg;
  errorBox.textContent = msg ?? '';
}

function defaultCount() {
  const v = sheetAllCount.valueAsNumber;
  return Number.isFinite(v) ? clamp(Math.floor(v), 0, MAX_COUNT) : 1;
}

function createPage(source: Source, file: File, template: Page | null): Page {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.setAttribute('role', 'option');
  card.tabIndex = 0;
  card.title = file.name;

  const thumb = document.createElement('canvas');
  thumb.className = 'page-thumb';
  const num = document.createElement('span');
  num.className = 'page-num';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'page-del';
  del.textContent = '×';
  const countLabel = document.createElement('label');
  countLabel.className = 'page-count';
  countLabel.title = 'Copies in the PDF';
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '0';
  countInput.max = String(MAX_COUNT);
  countInput.step = '1';
  countLabel.append('×', countInput);
  card.append(thumb, num, del, countLabel);

  const page: Page = {
    id: nextId++,
    source,
    name: file.name.replace(/\.[^.]+$/, '') || 'image',
    fileName: file.name || 'pasted image',
    zoom: 1,
    panX: 0,
    panY: 0,
    // New pages start with the background of the page that was being edited.
    bgMode: template?.bgMode ?? 'transparent',
    bgColor: template?.bgColor ?? '#ffffff',
    count: defaultCount(),
    card,
    thumb,
    num,
    del,
    countInput,
  };
  countInput.value = String(page.count);

  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, input, label')) return;
    selectPage(page.id);
  });
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    const i = pages.indexOf(page);
    if (e.key === 'Enter' || e.key === ' ') selectPage(page.id);
    else if (e.key === 'Delete') removePage(page.id);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pages[i + 1]?.card.focus();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pages[i - 1]?.card.focus();
    else return;
    e.preventDefault();
  });
  del.addEventListener('click', () => removePage(page.id));
  countInput.addEventListener('input', () => {
    const v = countInput.valueAsNumber;
    if (Number.isFinite(v) && v >= 0) {
      page.count = clamp(Math.floor(v), 0, MAX_COUNT);
      scheduleRender();
    }
  });
  countInput.addEventListener('change', () => {
    countInput.value = String(page.count);
  });
  return page;
}

/** Refreshes numbering, selection, and labels of all page cards. */
function updateCards() {
  pages.forEach((p, i) => {
    const selected = p.id === currentId;
    p.num.textContent = String(i + 1);
    p.card.classList.toggle('selected', selected);
    p.card.setAttribute('aria-selected', String(selected));
    p.card.setAttribute('aria-label', `Page ${i + 1}: ${p.fileName}`);
    p.del.setAttribute('aria-label', `Remove page ${i + 1}`);
    p.del.title = `Remove page ${i + 1}`;
    p.countInput.setAttribute('aria-label', `Copies of page ${i + 1} in the PDF`);
    p.card.classList.toggle('not-printed', p.count === 0);
  });
}

function selectPage(id: number) {
  currentId = id;
  updateCards();
  current()?.card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  scheduleRender();
}

function removePage(id: number) {
  const i = pages.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [page] = pages.splice(i, 1);
  page.card.remove();
  releaseSource(page.source);
  if (currentId === id) currentId = (pages[i] ?? pages[i - 1])?.id ?? null;
  updateCards();
  (current()?.card ?? dropzone).focus({ preventScroll: true });
  scheduleRender();
}

function drawThumb(p: Page) {
  const px = Math.round(THUMB_CSS * (devicePixelRatio || 1));
  renderRound(p.thumb, p.source, renderOptions(p, project.innerExport), px / project.size);
}

let thumbTimer = 0;
function scheduleThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    pages.forEach(drawThumb);
    updateCards();
  }, 120);
}

let adding = Promise.resolve();

function addFiles(files: File[]) {
  // Serialize batches so pages keep the order in which they were added.
  adding = adding.then(() => addFilesNow(files));
}

async function addFilesNow(files: File[]) {
  const images = files.filter((f) => !f.type || f.type.startsWith('image/'));
  const skipped = files.filter((f) => !images.includes(f)).map((f) => f.name);
  if (!images.length) {
    if (skipped.length) showError(`Not an image: ${skipped.join(', ')}`);
    return;
  }
  showError(null);
  const failed: string[] = [];
  let first = true;
  for (const [i, file] of images.entries()) {
    pagesStatus.textContent = images.length > 1 ? `Adding image ${i + 1} of ${images.length}…` : 'Adding image…';
    try {
      const source = await decodeImage(file);
      const page = createPage(source, file, current());
      pages.push(page);
      pageList.append(page.card);
      drawThumb(page);
      if (first) {
        selectPage(page.id);
        first = false;
      } else {
        updateCards();
        scheduleRender();
      }
    } catch {
      failed.push(file.name);
    }
  }
  pagesStatus.textContent = '';
  const problems = [
    failed.length ? `Your browser cannot decode: ${failed.join(', ')}. Try JPEG, PNG, WebP, GIF, BMP, SVG or AVIF.` : '',
    skipped.length ? `Not an image: ${skipped.join(', ')}.` : '',
  ].filter(Boolean);
  showError(problems.length ? problems.join(' ') : null);
}

fileInput.addEventListener('change', () => {
  addFiles([...(fileInput.files ?? [])]);
  fileInput.value = '';
});

dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

for (const type of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop'] as const) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('dragging'));
}
// Files dropped anywhere on the page are added as pages (and the browser doesn't navigate to them).
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles([...(e.dataTransfer?.files ?? [])]);
});

window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) addFiles(files);
});

// Pages exist only in memory; warn before they are lost.
window.addEventListener('beforeunload', (e) => {
  if (pages.length) e.preventDefault();
});

// ---------- Project controls ----------

function readNumber(input: HTMLInputElement): number | null {
  const v = input.valueAsNumber;
  return Number.isFinite(v) ? v : null;
}

function setSize(v: number) {
  project.size = clamp(Math.round(v), MIN_SIZE, MAX_SIZE);
  scheduleRender();
}

sizeRange.addEventListener('input', () => setSize(sizeRange.valueAsNumber));
sizeNum.addEventListener('input', () => {
  const v = readNumber(sizeNum);
  if (v !== null && v >= MIN_SIZE && v <= MAX_SIZE) setSize(v);
});
sizeNum.addEventListener('change', () => {
  setSize(readNumber(sizeNum) ?? project.size);
  sizeNum.value = String(project.size);
});

document.querySelectorAll<HTMLButtonElement>('button[data-size]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.size;
    const page = current();
    if (preset === 'original') {
      if (page) setSize(Math.min(page.source.width, page.source.height));
    } else if (preset) {
      setSize(Number(preset));
    }
  });
});

innerVisible.addEventListener('change', () => {
  project.innerVisible = innerVisible.checked;
  scheduleRender();
});

function setInnerPx(px: number) {
  project.innerRatio = clamp(px, 1, project.size) / project.size;
  scheduleRender();
}
function setInnerPct(pct: number) {
  project.innerRatio = clamp(pct, 0.1, 100) / 100;
  scheduleRender();
}
innerRange.addEventListener('input', () => setInnerPx(innerRange.valueAsNumber));
innerNum.addEventListener('input', () => {
  const v = readNumber(innerNum);
  if (v !== null && v >= 1 && v <= project.size) setInnerPx(v);
});
innerNum.addEventListener('change', () => {
  setInnerPx(readNumber(innerNum) ?? innerDiameter());
  innerNum.value = String(innerDiameter());
});
innerPctRange.addEventListener('input', () => setInnerPct(innerPctRange.valueAsNumber));
innerPct.addEventListener('input', () => {
  const v = readNumber(innerPct);
  if (v !== null && v > 0 && v <= 100) setInnerPct(v);
});
innerPct.addEventListener('change', () => {
  setInnerPct(readNumber(innerPct) ?? project.innerRatio * 100);
  innerPct.value = (project.innerRatio * 100).toFixed(1);
});

innerColor.addEventListener('input', () => {
  project.innerColor = innerColor.value;
  scheduleRender();
});

function setLineWidth(v: number) {
  project.innerLineWidth = clamp(Math.round(v), 0, 512);
  scheduleRender();
}
innerWidthRange.addEventListener('input', () => setLineWidth(innerWidthRange.valueAsNumber));
innerWidth.addEventListener('input', () => {
  const v = readNumber(innerWidth);
  if (v !== null && v >= 0) setLineWidth(v);
});
innerWidth.addEventListener('change', () => {
  setLineWidth(readNumber(innerWidth) ?? project.innerLineWidth);
  innerWidth.value = String(project.innerLineWidth);
});

innerStyle.addEventListener('change', () => {
  const v = innerStyle.value as LineStyle;
  if (LINE_STYLES.includes(v)) project.innerLineStyle = v;
  scheduleRender();
});
innerFill.addEventListener('input', () => {
  project.innerFill = innerFill.valueAsNumber / 100;
  scheduleRender();
});
innerExport.addEventListener('change', () => {
  project.innerExport = innerExport.checked;
  scheduleRender();
});

showBounds.addEventListener('change', () => {
  project.showBounds = showBounds.checked;
  scheduleRender();
});

// ---------- Current page controls ----------

function setZoom(z: number) {
  const page = current();
  if (!page) return;
  page.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
  scheduleRender();
}
// The slider is logarithmic so shrinking (< 1×) and enlarging get equal travel.
zoomRange.addEventListener('input', () => setZoom(2 ** zoomRange.valueAsNumber));
zoomNum.addEventListener('input', () => {
  const v = readNumber(zoomNum);
  if (v !== null && v >= MIN_ZOOM && v <= MAX_ZOOM) setZoom(v);
});
zoomNum.addEventListener('change', () => {
  const page = current();
  setZoom(readNumber(zoomNum) ?? page?.zoom ?? 1);
  zoomNum.value = String(+(current()?.zoom ?? 1).toFixed(2));
});

function setZoomPreset(zoomFor: (src: Source, size: number) => number) {
  const page = current();
  if (!page) return;
  page.panX = 0;
  page.panY = 0;
  setZoom(zoomFor(page.source, project.size));
}
zoomFill.addEventListener('click', () => setZoomPreset(() => 1));
zoomFit.addEventListener('click', () => setZoomPreset(fitZoom));
zoomActual.addEventListener('click', () => setZoomPreset(actualSizeZoom));
centerPos.addEventListener('click', () => {
  const page = current();
  if (!page) return;
  page.panX = 0;
  page.panY = 0;
  scheduleRender();
});

function onBackgroundChange() {
  const page = current();
  if (!page) return;
  const mode = document.querySelector<HTMLInputElement>('input[name="bg"]:checked')?.value;
  page.bgMode = mode === 'color' ? 'color' : 'transparent';
  page.bgColor = bgColor.value;
  scheduleRender();
}
bgRadios.forEach((r) => r.addEventListener('change', onBackgroundChange));
bgColor.addEventListener('input', onBackgroundChange);
// Clicking the color swatch implies the user wants a colored background.
bgColor.addEventListener('click', () => {
  const colorRadio = [...bgRadios].find((r) => r.value === 'color');
  if (colorRadio && !colorRadio.checked) {
    colorRadio.checked = true;
    onBackgroundChange();
  }
});

// ---------- Pan & zoom on the preview (mouse, touch, pen) ----------

const pointers = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; x: number; y: number } | null = null;

/** CSS px of the preview that correspond to the full output diameter. */
const outputCssSize = () => (canvas.clientWidth || 1) / viewFactor();

/** Zooms while keeping the image point under (clientX, clientY) fixed on screen. */
function zoomAt(page: Page, newZoom: number, clientX: number, clientY: number) {
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const rect = canvas.getBoundingClientRect();
  const w = outputCssSize();
  const mx = (clientX - (rect.left + rect.width / 2)) / w;
  const my = (clientY - (rect.top + rect.height / 2)) / w;
  const f = z / page.zoom;
  page.panX = mx - (mx - page.panX) * f;
  page.panY = my - (my - page.panY) * f;
  page.zoom = z;
  scheduleRender();
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!current()) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('grabbing');
  if (pointers.size === 2) pinch = pinchInfo();
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  const page = current();
  if (!prev || !page) return;
  const w = outputCssSize();
  if (pointers.size === 1) {
    page.panX += (e.clientX - prev.x) / w;
    page.panY += (e.clientY - prev.y) / w;
    prev.x = e.clientX;
    prev.y = e.clientY;
    scheduleRender();
    return;
  }
  prev.x = e.clientX;
  prev.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const now = pinchInfo();
    // Move with the fingers' midpoint, then scale around it.
    page.panX += (now.x - pinch.x) / w;
    page.panY += (now.y - pinch.y) / w;
    if (pinch.dist > 0) zoomAt(page, page.zoom * (now.dist / pinch.dist), now.x, now.y);
    pinch = now;
    scheduleRender();
  }
});

const endPointer = (e: PointerEvent) => {
  if (!pointers.delete(e.pointerId)) return;
  pinch = pointers.size === 2 ? pinchInfo() : null;
  if (pointers.size === 0) {
    canvas.classList.remove('grabbing');
    // Thumbnails and the print-sheet preview are skipped while dragging; refresh them now.
    scheduleRender();
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
// Safari fires proprietary gesture events for pinches; stop them from zooming the page.
canvas.addEventListener('gesturestart', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    const page = current();
    if (!page) return;
    e.preventDefault();
    zoomAt(page, page.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  },
  { passive: false },
);

canvas.addEventListener('keydown', (e) => {
  const page = current();
  if (!page) return;
  const step = e.shiftKey ? 0.05 : 0.01;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  if (e.key in moves) {
    const [dx, dy] = moves[e.key];
    page.panX += dx;
    page.panY += dy;
  } else if (e.key === '+' || e.key === '=') {
    page.zoom = clamp(page.zoom * 1.1, MIN_ZOOM, MAX_ZOOM);
  } else if (e.key === '-') {
    page.zoom = clamp(page.zoom / 1.1, MIN_ZOOM, MAX_ZOOM);
  } else {
    return;
  }
  e.preventDefault();
  scheduleRender();
});

new ResizeObserver(() => scheduleRender()).observe(canvas.parentElement!);

// ---------- Page image download & share ----------

async function exportImage(share: boolean) {
  const page = current();
  if (!page) return;
  try {
    const out = document.createElement('canvas');
    renderRound(out, page.source, renderOptions(page, project.innerExport));
    const type = formatSel.value;
    const ext = type === 'image/webp' ? 'webp' : 'png';
    const blob = await canvasToBlob(out, type, 0.95);
    const name = `${page.name}-round-${project.size}.${ext}`;
    if (share) await shareOrSave(blob, name);
    else saveBlob(blob, name);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

downloadBtn.addEventListener('click', () => void exportImage(false));
shareBtn.addEventListener('click', () => void exportImage(true));

// ---------- Print sheet (PDF) ----------

let pdfBusy = false;

function readSheet(): { sheet: SheetOptions; dpi: number; cutLines: boolean } {
  const num = (el: HTMLInputElement, fallback: number) => (Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : fallback);
  const pageName = sheetPage.value;
  let [w, h] =
    pageName === 'custom' ? [num(sheetWidth, 210), num(sheetHeight, 297)] : [...PAGE_SIZES[pageName as PageSizeName]];
  if (sheetOrientation.value === 'landscape' ? w < h : w > h) [w, h] = [h, w];
  return {
    sheet: {
      pageWidth: w,
      pageHeight: h,
      margin: Math.max(0, num(sheetMargin, 10)),
      gap: Math.max(0, num(sheetGap, 5)),
      diameter: num(sheetDiameter, 45),
      count: printSequence().length,
      center: sheetCenter.checked,
    },
    dpi: Number(sheetDpi.value) || 300,
    cutLines: sheetCutLines.checked,
  };
}

/** Page index for every printed copy, in page order. */
function printSequence(): number[] {
  return pages.flatMap((p, i) => Array<number>(p.count).fill(i));
}

/** Pixel size of the embedded images so they print at the chosen DPI (capped for canvas limits). */
const sheetImagePx = (diameterMm: number, dpi: number) =>
  Math.min(MAX_SHEET_IMAGE_PX, Math.max(1, Math.round((diameterMm / 25.4) * dpi)));

function disablePdf(disabled: boolean) {
  downloadPdfBtn.disabled = disabled;
  sharePdfBtn.disabled = disabled;
}

function updateSheet() {
  sheetCustom.hidden = sheetPage.value !== 'custom';
  if (!pages.length) {
    sheetSummary.textContent = 'Add images to create a print sheet.';
    sheetSummary.classList.remove('error');
    sheetPreview.hidden = true;
    disablePdf(true);
    return;
  }

  const { sheet, dpi, cutLines } = readSheet();
  const seq = printSequence();
  const layout = layoutSheet(sheet);
  const fmt = (v: number) => +v.toFixed(1);

  if ('error' in layout) {
    sheetSummary.textContent = layout.error;
    sheetSummary.classList.add('error');
    sheetPreview.hidden = true;
    disablePdf(true);
    return;
  }
  sheetSummary.classList.remove('error');
  sheetPreview.hidden = false;
  disablePdf(pdfBusy);

  const sheets = layout.pages.length;
  const usedPages = pages.filter((p) => p.count > 0).length;
  const firstRows = Math.ceil(layout.pages[0].length / layout.cols);
  const px = sheetImagePx(sheet.diameter, dpi);
  sheetSummary.textContent =
    `${plural(seq.length, 'image')} from ${plural(usedPages, 'page')} → ${plural(sheets, 'sheet')}` +
    (sheets === 1 ? ` (${Math.min(layout.cols, seq.length)} × ${firstRows})` : '') +
    `. Sheet ${fmt(sheet.pageWidth)} × ${fmt(sheet.pageHeight)} mm fits ${layout.cols} × ${layout.rows} = ${layout.perPage}. ` +
    `Each image ${fmt(sheet.diameter)} mm = ${px} px` +
    (px === MAX_SHEET_IMAGE_PX ? ' (capped)' : ` at ${dpi} DPI`) +
    (sheets > 1 ? '. Preview shows sheet 1.' : '.');

  // First-sheet preview
  const dpr = devicePixelRatio || 1;
  const maxCss = Math.min(280, (sheetFieldset.clientWidth || 300) - 30);
  const k = Math.min(maxCss / sheet.pageWidth, 360 / sheet.pageHeight);
  const cssW = sheet.pageWidth * k;
  const cssH = sheet.pageHeight * k;
  sheetPreview.style.width = `${cssW}px`;
  sheetPreview.style.height = `${cssH}px`;
  sheetPreview.width = Math.round(cssW * dpr);
  sheetPreview.height = Math.round(cssH * dpr);
  const ctx = sheetPreview.getContext('2d')!;
  const s = k * dpr; // canvas px per mm
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.pageWidth, sheet.pageHeight);

  ctx.setLineDash([2, 2]);
  ctx.lineWidth = 0.6 / k;
  ctx.strokeStyle = 'rgba(79, 70, 229, 0.5)';
  ctx.strokeRect(sheet.margin, sheet.margin, sheet.pageWidth - 2 * sheet.margin, sheet.pageHeight - 2 * sheet.margin);
  ctx.setLineDash([]);

  const d = sheet.diameter;
  const buffers = new Map<number, HTMLCanvasElement>();
  layout.pages[0].forEach((p, slot) => {
    const pageIndex = seq[slot];
    let buf = buffers.get(pageIndex);
    if (!buf) {
      buf = document.createElement('canvas');
      const page = pages[pageIndex];
      renderRound(buf, page.source, renderOptions(page, project.innerExport), Math.max(1, d * s) / project.size);
      buffers.set(pageIndex, buf);
    }
    ctx.drawImage(buf, p.x, p.y, d, d);
    if (cutLines) {
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 0.5 / k;
      ctx.beginPath();
      ctx.arc(p.x + d / 2, p.y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

sheetFieldset.addEventListener('input', () => scheduleRender());
sheetFieldset.addEventListener('change', () => scheduleRender());
// Start loading the PDF library as soon as the user works with the print settings, so that
// generation is quick enough for the share sheet (which needs a recent tap) on mobile.
const preloadPdfLib = () => void import('pdf-lib');
sheetFieldset.addEventListener('focusin', preloadPdfLib, { once: true });
sheetFieldset.addEventListener('pointerdown', preloadPdfLib, { once: true });

sheetAllApply.addEventListener('click', () => {
  const v = defaultCount();
  sheetAllCount.value = String(v);
  for (const p of pages) {
    p.count = v;
    p.countInput.value = String(v);
  }
  updateCards();
  scheduleRender();
});

async function exportPdf(share: boolean) {
  if (!pages.length || pdfBusy) return;
  const { sheet, dpi, cutLines } = readSheet();
  const layout = layoutSheet(sheet);
  if ('error' in layout) return;

  pdfBusy = true;
  disablePdf(true);
  const btn = share ? sharePdfBtn : downloadPdfBtn;
  const label = btn.textContent;
  btn.textContent = 'Generating PDF…';
  try {
    const px = sheetImagePx(sheet.diameter, dpi);
    const images: ArrayBuffer[] = [];
    const imageOfPage = new Map<number, number>();
    const used = pages.filter((p) => p.count > 0);
    for (const page of used) {
      const out = document.createElement('canvas');
      renderRound(out, page.source, renderOptions(page, project.innerExport), px / project.size);
      imageOfPage.set(pages.indexOf(page), images.length);
      images.push(await (await canvasToBlob(out, 'image/png')).arrayBuffer());
    }
    const sequence = printSequence().map((i) => imageOfPage.get(i)!);
    const base = used.length === 1 ? used[0].name : 'round-images';
    const bytes = await buildPdf({
      sheet,
      layout,
      images,
      sequence,
      cutLines,
      title: `${base} – ${sequence.length} × ${sheet.diameter} mm`,
    });
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const name = `${base}-${sheet.diameter}mm-x${sequence.length}.pdf`;
    if (share) await shareOrSave(blob, name);
    else saveBlob(blob, name);
  } catch (err) {
    showError(`Could not create the PDF: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    pdfBusy = false;
    btn.textContent = label;
    scheduleRender();
  }
}

downloadPdfBtn.addEventListener('click', () => void exportPdf(false));
sharePdfBtn.addEventListener('click', () => void exportPdf(true));

render();
