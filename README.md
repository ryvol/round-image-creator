# Round Image Maker

A browser-only tool that turns images (JPEG, PNG, WebP, GIF, BMP, SVG, AVIF, ICO) of any size into round images of one common size, optionally with an inner circle, and prints them on PDF sheets.

Everything runs in your browser using the Canvas API, so your images never leave your computer.

## How it works: a project with pages

- **Project settings** apply to all pages: output diameter and format, inner circle, and the print sheet settings.
- **Pages:** every added image becomes a page. Add many at once by clicking (multi-select), dragging and dropping, or pasting (Ctrl+V). The **Pages** strip shows a live round thumbnail of each page.
  - Click a thumbnail to edit that page. Press **×** to remove it.
  - The **× N** box sets how many copies of that page go into the PDF. 0 leaves it out.
- **Current page** settings belong to the selected page only: **Image position** (zoom and movement) and **Background**. **Download page image** saves that page's round image.
- New pages start centered at "Fill circle", with the background of the page you were editing.
- Pages are kept in memory only. The browser warns you before you close or reload the tab.

## Features

- Output diameter from 16 to 8192 px, with presets and an "Original" option (uses the shorter side of the current page's image).
- Images are center-cropped to fill the circle by default. Zoom from 0.05× to 20× using the logarithmic slider, the number box, the mouse wheel, or `+`/`-`. You can move the image freely by dragging or with the arrow keys: any part of it, even an edge or corner, can be centered in the circle. Uncovered areas show the background.
- Zoom below 1× makes the image smaller than the circle. Presets: **Fill circle** (1×), **Fit inside** (the whole image fits in the circle), **Actual size** (1 image px = 1 output px), and **Center**.
- **Show image bounds in preview** (on by default): the preview also shows the parts of the image cropped away by the circle (faded), with a dashed outline of the whole image's outer edge and a thin outline of the output circle. This only affects the preview.
- Background per page: **Transparent** or any **Color**. It fills the circle wherever the image doesn't cover it, including transparent parts of the image. The area outside the circle is always transparent.
- Inner circle (project-wide): diameter in px or %, color, line width, line style (solid, dashed, long dash, dotted, dash-dot), and fill opacity. You can choose whether it is included in downloads and the PDF (off by default, so it works as a preview-only guide). Defaults: 71% of the diameter, red, dashed, 1 px line.
- Downloads are PNG or WebP with transparent corners.
- EXIF orientation of photos is applied automatically.
- **Print sheet (PDF):**
  - Set the printed image size in mm (for example 45 mm) and the sheet size (A3, A4, A5, Letter, Legal, or a custom width × height in mm), with orientation, margin, and spacing.
  - The copies of all pages are placed in page order, filling each sheet row by row with as many per row and column as fit. For example, 9 images of 45 mm on A4 give a 3 × 3 grid. More sheets are added as needed.
  - **All pages × N → Apply to all** sets every page's copy count. Its value is also the default count for newly added pages.
  - Options: center on the sheet, thin cut lines, and 150/300/600 DPI image resolution. A live preview of the first sheet is shown.
  - Each distinct image is embedded only once, which keeps the PDF small. The PDF is created in the browser with [pdf-lib](https://pdf-lib.js.org/), which is loaded only when needed.
  - Print the PDF at **100% / "Actual size"** (not "Fit to page") to keep the exact mm sizes.
- **Smartphones (Android & iOS):**
  - Responsive single-column layout with the preview pinned at the top while you scroll the settings.
  - Touch-sized controls, and inputs that don't trigger iOS auto-zoom. Safe-area insets are respected (notch / home indicator).
  - One-finger drag to move and two-finger pinch to zoom, centered on your fingers.
  - "Add photos" opens the gallery, files, or camera.
  - **Share / Save** and **Share PDF** buttons use the system share sheet (for example *Save Image* to Photos on iOS, or a printer app), with a regular download as fallback.
- **Memory limits:** decoded images are capped at 4096 px on desktop and 2048 px on phones and tablets, because every page keeps its image in memory. On iOS, canvases (and so the output size) are capped at 4096 px because of Safari's canvas memory limit.

## Run

Requires Node.js 18+ (the project uses Vite 6).

```powershell
npm install
npm run dev       # development server at http://localhost:5173
npm run build     # static production build in dist/
npm run preview   # serve the production build
```

To try it on a phone during development, run `npm run dev -- --host` and open the shown *Network* URL on a phone in the same Wi-Fi. File sharing (the Share buttons) requires HTTPS when hosted, which GitHub Pages, Netlify, and similar services provide.

The `dist/` folder is a plain static site. You can host it anywhere, such as GitHub Pages, Netlify, or any web server.

## Structure

- `index.html`: page layout and controls
- `src/main.ts`: project and page state, UI, interactions, page image download, PDF export
- `src/render.ts`: pure rendering logic (circle clip, cover scaling, pan clamping, inner circle, preview)
- `src/sheet.ts`: print sheet grid layout (mm) and PDF generation with multiple images
- `src/decode.ts`: image decoding (EXIF orientation, SVG rasterizing, size limits)
- `src/files.ts`: download, share, and canvas-to-blob helpers
- `src/env.ts`: device detection and canvas/memory limits
- `src/style.css`: styles (light and dark theme, touch, and mobile layout)
