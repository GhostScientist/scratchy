export interface NegotiatedFormat {
  mimeType: string;
  extension: string;
}

/** Ordered candidates: mp4 first (plays everywhere once downloaded, and is
 *  the only thing Safari records reliably — some Safari builds CLAIM webm
 *  support in isTypeSupported yet produce zero bytes on canvas streams, so
 *  webm must never outrank mp4 here), then webm for Chromium/Firefox.
 *  Codec/container mismatches from bare "video/mp4" (e.g. Chromium builds
 *  without H.264 silently record VP9-in-MP4) are corrected after the fact:
 *  the delivery remux (remux.ts) picks the final container by actual codec.
 *  A format that negotiates but records nothing is handled at runtime by the
 *  recorder's first-bytes failover (useRecorder.ts), not by ordering. */
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

/** Never assume a container — ask the browser what it can actually record.
 *  `exclude` holds formats that negotiated but then failed to produce data,
 *  so a retry can move on to the next candidate. */
export function negotiateFormat(exclude?: ReadonlySet<string>): NegotiatedFormat | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const mimeType of CANDIDATES) {
    if (exclude?.has(mimeType)) continue;
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, extension: extensionFor(mimeType) };
    }
  }
  return null;
}
