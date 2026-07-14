export interface NegotiatedFormat {
  mimeType: string;
  extension: string;
}

/** Ordered candidates: mp4 first (plays everywhere once downloaded, and is
 *  the only thing Safari produces), then webm for Chromium/Firefox. */
const CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01F,mp4a.40.2"',
  'video/mp4',
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm',
];

export function extensionFor(mimeType: string): string {
  return mimeType.includes('mp4') ? '.mp4' : '.webm';
}

/** Never assume a container — ask the browser what it can actually record. */
export function negotiateFormat(): NegotiatedFormat | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const mimeType of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension: extensionFor(mimeType) };
    }
  }
  return null;
}
