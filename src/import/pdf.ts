import { putAsset } from '../persistence/assets';
import { seedImageBitmap } from '../lib/imageCache';
import { clamp } from '../lib/geometry';
import { nextId, MIN_ZOOM, MAX_ZOOM, STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import type { BoardPage, ImageElement } from '../types';

/** Rendered page bitmaps are capped to this long edge — crisp at readable
 *  zooms without decoding tens of megapixels per slide. */
const MAX_RENDER_EDGE = 2000;
/** Never upsample tiny pages more than this. */
const MAX_RENDER_SCALE = 3;
/** Import cap; a deck longer than this is a document, not a lesson. */
export const MAX_PDF_PAGES = 100;
/** World padding around a slide backdrop when its page viewport is fitted. */
const FIT_PADDING = 24;

export interface PdfImportResult {
  pages: BoardPage[];
  /** Total pages in the file — more than pages.length when capped. */
  totalPages: number;
}

function encodeCanvas(canvas: HTMLCanvasElement): Promise<{ blob: Blob; mime: string } | null> {
  return new Promise((resolve) => {
    // JPEG keeps 2000px slides ~100-300 KB; PNG is the alpha-safe fallback.
    canvas.toBlob(
      (jpeg) => {
        if (jpeg) {
          resolve({ blob: jpeg, mime: 'image/jpeg' });
          return;
        }
        canvas.toBlob(
          (png) => resolve(png ? { blob: png, mime: 'image/png' } : null),
          'image/png',
        );
      },
      'image/jpeg',
      0.85,
    );
  });
}

/** One board page per PDF page: the render becomes a locked backdrop element
 *  centered on the stage rect, and the page viewport is preset to frame it. */
function backdropPage(assetId: string, pixelW: number, pixelH: number): BoardPage {
  const fit = Math.min(1, STAGE_WIDTH / pixelW, STAGE_HEIGHT / pixelH);
  const w = pixelW * fit;
  const h = pixelH * fit;
  const el: ImageElement = {
    kind: 'image',
    id: nextId('im'),
    assetId,
    x: (STAGE_WIDTH - w) / 2,
    y: (STAGE_HEIGHT - h) / 2,
    w,
    h,
    naturalW: pixelW,
    naturalH: pixelH,
    locked: true,
  };
  // Same math as Viewport.fitBBox: open the page showing the whole slide.
  const zoom = clamp(
    Math.min(STAGE_WIDTH / (w + FIT_PADDING * 2), STAGE_HEIGHT / (h + FIT_PADDING * 2)),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  return {
    id: nextId('pg'),
    elements: [el],
    viewport: {
      x: STAGE_WIDTH / 2 - STAGE_WIDTH / (2 * zoom),
      y: STAGE_HEIGHT / 2 - STAGE_HEIGHT / (2 * zoom),
      zoom,
    },
  };
}

/**
 * Render every page of a PDF to an asset and return ready-to-append board
 * pages. pdfjs-dist is loaded lazily so the whiteboard bundle never pays for
 * it; the worker ships with the app (offline-safe, no CDN).
 */
export async function importPdf(
  file: File,
  onProgress: (done: number, total: number) => void,
): Promise<PdfImportResult> {
  // The legacy build supports the browsers this PWA targets (tablets a few
  // years old); the default v6 build needs bleeding-edge JS engine features.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await loadingTask.promise;
  try {
    const total = doc.numPages;
    const count = Math.min(total, MAX_PDF_PAGES);
    onProgress(0, count);
    const pages: BoardPage[] = [];
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_RENDER_EDGE / Math.max(base.width, base.height), MAX_RENDER_SCALE);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D is not available');
      // PDF pages can be transparent; slides read as paper.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();

      const encoded = await encodeCanvas(canvas);
      if (!encoded) throw new Error('Could not encode the page render');
      const assetId = nextId('as');
      const stored = await putAsset({
        id: assetId,
        blob: encoded.blob,
        mime: encoded.mime,
        width: canvas.width,
        height: canvas.height,
        createdAt: Date.now(),
      });
      if (!stored) throw new Error('Could not save the page. Device storage may be full.');
      try {
        seedImageBitmap(assetId, await createImageBitmap(canvas));
      } catch {
        // The render cache will decode from the stored blob on demand.
      }
      pages.push(backdropPage(assetId, canvas.width, canvas.height));
      onProgress(i, count);
    }
    return { pages, totalPages: total };
  } finally {
    void loadingTask.destroy();
  }
}
