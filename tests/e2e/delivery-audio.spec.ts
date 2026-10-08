import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Downloaded takes must play — with sound — in players outside the browser.
 * MediaRecorder can put container-hostile audio in its stream (Chrome without
 * an AAC encoder records Opus into `video/mp4`; QuickTime and Windows Media
 * Player then refuse the file or play it silent). remuxForDelivery transcodes
 * such an audio track to the target container's native codec when this
 * browser can encode it, and otherwise must still deliver every track.
 *
 * These specs drive the real remux module in the page against pre-built
 * fixture files, since the sandbox browser can't record every codec combo.
 */

function fixture(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', 'fixtures', name)).toString('base64');
}

/** Run remuxForDelivery on fixture bytes in the page; inspect via mediabunny. */
function remuxInPage(page: Page, base64: string) {
  return page.evaluate(async (b64) => {
    const { remuxForDelivery } = await import('/src/recording/remux.ts');
    // Vite's dev-server id resolution — same module instance remux.ts uses.
    const { Input, BlobSource, ALL_FORMATS } = await import('/@id/mediabunny');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const result = await remuxForDelivery(new Blob([bytes]));
    if (!result) return null;
    const input = new Input({ source: new BlobSource(result.blob), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      mimeType: result.mimeType,
      extension: result.extension,
      size: result.blob.size,
      videoCodec: video?.codec ?? null,
      audioCodec: audio?.codec ?? null,
      duration: await input.computeDuration(),
    };
  }, base64);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.boards-menu');
});

test('container-hostile audio is transcoded to the delivery codec', async ({ page }) => {
  // VP9 video forces WebM delivery; FLAC audio is illegal in WebM. This
  // browser can decode FLAC and encode Opus, so the track must come out
  // as Opus — not dropped, and not smuggled through as FLAC.
  const result = await remuxInPage(page, fixture('vp9-flac.mkv'));
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('video/webm');
  expect(result!.extension).toBe('.webm');
  expect(result!.videoCodec).toBe('vp9');
  expect(result!.audioCodec).toBe('opus');
  expect(result!.duration).toBeGreaterThan(0.9);
});

test('audio passes through when the compat codec cannot be encoded here', async ({ page }) => {
  // H.264 video forces MP4 delivery; Opus audio should become AAC, but this
  // sandbox browser has no AAC encoder. The delivery must then keep the
  // Opus track (in-browser playback still works) rather than drop it or
  // fail the remux — losing a recorded track is never acceptable.
  const canAac = await page.evaluate(async () => {
    const { canEncodeAudio } = await import('/@id/mediabunny');
    return canEncodeAudio('aac', { bitrate: 128_000 });
  });
  const result = await remuxInPage(page, fixture('h264-opus-frag.mp4'));
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('video/mp4');
  expect(result!.videoCodec).toBe('avc');
  expect(result!.audioCodec).toBe(canAac ? 'aac' : 'opus');
  expect(result!.duration).toBeGreaterThan(0.9);
});

for (const [name, mimeType, audioCodec] of [
  ['h264-opus-frag.mp4', 'video/mp4', 'aac'],
  ['vp9-flac.mkv', 'video/webm', 'opus'],
] as const) {
  test(`edited ${name} uses the current audio delivery rules`, async ({ page }) => {
    const result = await page.evaluate(async (b64) => {
      const { editTake } = await import('/src/recording/editTake.ts');
      const { DELIVERY_VERSION } = await import('/src/recording/remux.ts');
      const { Input, BlobSource, ALL_FORMATS, canEncodeAudio } = await import('/@id/mediabunny');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const delivered = await editTake({
        blob: new Blob([bytes]), url: '', mimeType: '', extension: '',
        durationMs: 1000, createdAt: Date.now(), seekable: true, deliveryVersion: 1,
      }, { start: 0.1, end: 0.8, muted: false }, new AbortController().signal, () => {});
      const input = new Input({ source: new BlobSource(delivered.blob), formats: ALL_FORMATS });
      try {
        return {
          mimeType: delivered.mimeType,
          audioCodec: (await input.getPrimaryAudioTrack())?.codec,
          duration: await input.getDurationFromMetadata(),
          version: delivered.deliveryVersion,
          expectedVersion: DELIVERY_VERSION,
          canAac: await canEncodeAudio('aac', { bitrate: 128_000 }),
        };
      } finally {
        input.dispose();
      }
    }, fixture(name));
    expect(result.mimeType).toBe(mimeType);
    expect(result.audioCodec).toBe(mimeType === 'video/mp4' && !result.canAac ? 'opus' : audioCodec);
    expect(result.duration).toBeCloseTo(0.7, 2);
    expect(result.version).toBe(result.expectedVersion);
  });
}
