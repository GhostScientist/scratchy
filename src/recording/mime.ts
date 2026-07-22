export interface NegotiatedFormat {
  mimeType: string;
  extension: string;
}

/** Ordered candidates: explicit H.264 mp4 first (plays everywhere once
 *  downloaded, and is what Safari produces), then webm for Chromium/Firefox.
 *  Bare "video/mp4" goes LAST: Chromium builds without H.264 encoders accept
 *  it and silently record VP9 *inside* an .mp4 — a file Apple players cannot
 *  decode at all. Such builds land on webm instead (their codec's native
 *  container); bare mp4 remains only for Safari versions that reject
 *  parameterized codec strings, where the default is H.264/AAC anyway. */
const CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01F,mp4a.40.2"',
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm',
  'video/mp4',
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
