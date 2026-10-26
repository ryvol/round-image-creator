import { IS_TOUCH } from './env';

export function saveBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  // Mobile browsers may read the blob lazily; keep the URL alive for a while.
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** File sharing (e.g. "Save Image" to Photos on iOS) is offered only on touch devices that support it. */
export const CAN_SHARE_FILES =
  IS_TOUCH &&
  typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File([''], 'test.png', { type: 'image/png' })] });

export async function shareOrSave(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: blob.type });
  if (CAN_SHARE_FILES && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // user closed the share sheet
      // Otherwise (e.g. the user gesture expired during slow generation) fall back to a download.
    }
  }
  saveBlob(blob, fileName);
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not create the image. Try a smaller diameter.'))),
      type,
      quality,
    ),
  );
}
