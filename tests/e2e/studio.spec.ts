import { test, expect } from '@playwright/test';
import type { Page, Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

async function seed(page: Page, countdownSeconds = 0, pauseReliable = true) {
  await page.addInitScript((settings) => {
    if (!localStorage.getItem('scratchy.settings.v1')) {
      localStorage.setItem('scratchy.settings.v1', JSON.stringify({
        handedness: 'right', presetId: 'compat', countdownSeconds: settings.countdownSeconds,
      }));
    }
    localStorage.setItem('scratchy.deviceProfile.v1', JSON.stringify({
      version: 1, userAgent: navigator.userAgent, mimeType: 'video/webm', extension: '.webm',
      smokeOk: true, supports1080p: true, supportsVertical: true, storageAdapter: 'idb',
      pauseReliable: settings.pauseReliable, storageEstimate: null, lastProbeAt: Date.now(), warnings: [],
    }));
  }, { countdownSeconds, pauseReliable });
}

async function openStudio(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchyRecorder !== undefined);
  await page.waitForSelector('.boards-menu');
}

async function record(page: Page, seconds = 3) {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => (window as any).__scratchyRecorder.getPhase() === 'recording');
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.modal-video')).toBeVisible();
  await expect(page.getByLabel('Trim start', { exact: true })).toBeEnabled();
}

async function inspect(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('No downloaded video');
  const bytes = await readFile(path);
  const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    return {
      duration: await input.computeDuration(),
      metadataDuration: await input.getDurationFromMetadata(),
      videoDuration: await video?.computeDuration(),
      audioDetails: await Promise.all((await input.getAudioTracks()).map(async (audio) => ({
        codec: audio.codec, first: await audio.getFirstTimestamp(), duration: await audio.computeDuration(),
      }))),
      audio: (await input.getAudioTracks()).length,
      width: await video?.getDisplayWidth(),
      height: await video?.getDisplayHeight(),
      firstTimestamp: await video?.getFirstTimestamp(),
    };
  } finally {
    input.dispose();
  }
}

test('notes autosave per board, teleprompter scrolls, and notes never become ink', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  await page.getByRole('button', { name: 'Presenter notes', exact: true }).click();
  const script = Array.from({ length: 60 }, (_, i) => `Talking point ${i}: private presenter script`).join('\n');
  await page.getByLabel('Notes script').fill(script);
  await page.getByRole('button', { name: 'Read notes', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-scroll', exact: true }).click();
  await expect.poll(() => page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBeGreaterThan(15);
  await page.getByRole('button', { name: 'Pause scroll', exact: true }).click();
  const position = await page.locator('.notes-reader').evaluate((el) => el.scrollTop);
  await page.waitForTimeout(250);
  expect(await page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBe(position);
  await page.getByRole('button', { name: 'Rewind notes', exact: true }).click();
  expect(await page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Add page (Page Down to flip)', exact: true }).click();
  await page.locator('.notes-reader').focus();
  await page.keyboard.press('PageUp');
  await expect(page.getByRole('tab', { name: 'Page 2 of 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as any).__scratchy.engine.getElements().length)).toBe(0);
  await page.waitForTimeout(750);
  await page.reload();
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Presenter notes', exact: true }).click();
  await expect(page.getByLabel('Notes script')).toHaveValue(script);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.getByLabel('Notes script')).toHaveValue('');
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.locator('.board-open').last().click();
  await expect(page.getByLabel('Notes script')).toHaveValue(script);
});

test('countdown preference persists and Escape cancels without a late recording', async ({ page }) => {
  await seed(page, 3);
  await openStudio(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: '5 second countdown', exact: true }).click();
  await page.reload();
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('.countdown-num')).toHaveText('5');
  await page.keyboard.press('Escape');
  await expect(page.locator('.countdown')).toBeHidden();
  await page.waitForTimeout(5200);
  expect(await page.evaluate(() => (window as any).__scratchyRecorder.getPhase())).toBe('idle');
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
});

test('teleprompter waits through countdown and pause, and recorded frames contain only the board', async ({ page }) => {
  await seed(page, 3);
  await openStudio(page);
  await page.getByRole('button', { name: 'Presenter notes', exact: true }).click();
  await page.getByLabel('Notes script').fill('PRIVATE SCRIPT\n'.repeat(100));
  await page.getByRole('button', { name: 'Read notes', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-scroll', exact: true }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('.countdown-num')).toHaveText('3');
  const countdownPosition = await page.locator('.notes-reader').evaluate((el) => el.scrollTop);
  await page.waitForTimeout(400);
  expect(await page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBe(countdownPosition);
  await page.waitForFunction(() => (window as any).__scratchyRecorder.getPhase() === 'recording');
  await expect.poll(() => page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBeGreaterThan(countdownPosition + 5);
  await page.getByRole('button', { name: 'Pause recording (Space)' }).click();
  const pausedPosition = await page.locator('.notes-reader').evaluate((el) => el.scrollTop);
  await page.waitForTimeout(350);
  expect(await page.locator('.notes-reader').evaluate((el) => el.scrollTop)).toBe(pausedPosition);
  await page.getByRole('button', { name: 'Resume recording (Space)' }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('.modal-video') as HTMLVideoElement)?.readyState >= 2);
  await page.locator('.modal-video').evaluate(async (el) => {
    const video = el as HTMLVideoElement;
    const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    video.currentTime = 0.2;
    await seeked;
  });
  const pixels = await page.locator('.modal-video').evaluate((el) => {
    const video = el as HTMLVideoElement;
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 9;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, 16, 9);
    return [...ctx.getImageData(0, 0, 16, 9).data].filter((_, i) => i % 4 !== 3);
  });
  expect(Math.min(...pixels)).toBeGreaterThan(245);
});

test('muting during a take mutes the actual recorded track, not just the meter', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const Original = window.MediaRecorder;
    window.MediaRecorder = new Proxy(Original, {
      construct(target, args) {
        const stream = args[0] as MediaStream;
        (window as any).__recordedAudio = stream.getAudioTracks();
        return Reflect.construct(target, args);
      },
    });
  });
  await openStudio(page);
  await page.getByRole('button', { name: 'Enable microphone (M)' }).click();
  await expect(page.getByRole('button', { name: 'Turn microphone off (M)' })).toBeVisible();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole('button', { name: 'Saved takes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mute microphone (M)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__recordedAudio[0]?.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Unmute microphone (M)' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__recordedAudio[0]?.enabled)).toBe(true);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.modal-video')).toBeVisible();
});

test('an unreliable pause profile disables keyboard pause as well as the button', async ({ page }) => {
  await seed(page, 0, false);
  await openStudio(page);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause recording (Space)' })).toHaveCount(0);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as any).__scratchyRecorder.getPhase())).toBe('recording');
  await expect(page.locator('.toast', { hasText: 'Pause is unavailable' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.modal-video')).toBeVisible();
});

test('trim, audio removal, undo/redo, download and saved copies honor the edit', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  await seed(page);
  if (browserName === 'webkit') {
    await page.addInitScript(() => {
      // WebKit can collect a MediaDevices wrapper and drop instance overrides.
      Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = async (constraints: MediaStreamConstraints) => {
        if (!constraints?.audio) throw new DOMException('Synthetic audio only', 'NotSupportedError');
        const context = new AudioContext();
        (window as any).__testAudioContext = context;
        const destination = context.createMediaStreamDestination();
        const tone = context.createOscillator();
        tone.connect(destination);
        const silentOutput = context.createGain();
        silentOutput.gain.value = 0;
        tone.connect(silentOutput);
        silentOutput.connect(context.destination);
        tone.start();
        void context.resume();
        return destination.stream;
      };
    });
  }
  await openStudio(page);
  await page.getByRole('button', { name: 'Enable microphone (M)' }).click();
  await expect(page.getByRole('button', { name: 'Turn microphone off (M)' })).toBeVisible();
  await record(page, 4);
  const originalUrl = await page.locator('.modal-video').getAttribute('src');
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download', exact: true }).click();
  const original = await inspect(await originalDownload);
  expect(original.audio).toBe(1);

  await page.getByLabel('Trim start', { exact: true }).fill('0.75');
  await page.getByLabel('Trim end', { exact: true }).fill('2.25');
  await page.getByRole('button', { name: 'Remove audio', exact: true }).click();
  await page.getByRole('button', { name: 'Undo video edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove audio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo video edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore audio', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const video = document.querySelector('.modal-video') as HTMLVideoElement;
    const times: number[] = [];
    (window as any).__previewFrames = times;
    const sample = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      times.push(metadata.mediaTime);
      if (!video.paused) video.requestVideoFrameCallback(sample);
    };
    video.addEventListener('play', () => video.requestVideoFrameCallback(sample), { once: true });
  });
  await page.getByRole('button', { name: 'Play selection', exact: true }).click();
  await expect.poll(() => page.locator('.modal-video').evaluate((el) => (el as HTMLVideoElement).paused)).toBe(true);
  const playhead = await page.locator('.modal-video').evaluate((el) => (el as HTMLVideoElement).currentTime);
  expect(playhead).toBeCloseTo(2.25, 1);
  const displayed = await page.evaluate(() => (window as any).__previewFrames as number[]);
  expect(displayed.length).toBeGreaterThan(1);
  expect(Math.max(...displayed)).toBeLessThanOrEqual(2.25 + 1 / 30);

  const trimmedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  const trimmed = await inspect(await trimmedDownload);
  expect(trimmed.duration).toBeCloseTo(1.5, 1);
  expect(trimmed.audio).toBe(0);
  expect(trimmed.width).toBe(1280);
  expect(trimmed.height).toBe(720);
  expect(trimmed.firstTimestamp).toBeLessThan(0.05);
  await expect(page.getByRole('link', { name: 'Download edited video', exact: true })).toHaveAttribute('href', /^blob:/);
  expect(await page.locator('.modal-video').getAttribute('src')).toBe(originalUrl);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved to library ✓' })).toBeVisible();
  const stored = await page.evaluate(async () => {
    const api = (window as any).__scratchyBoards;
    const { board } = await api.initBoards();
    const rows = await api.listTakes(board.id);
    return rows.map((row: any) => ({
      duration: row.durationMs, seekable: row.seekable, size: row.blob.size,
      deliveryVersion: row.deliveryVersion,
    }));
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].duration).toBeCloseTo(1500, 0);
  expect(stored[0].seekable).toBe(true);
  expect(stored[0].deliveryVersion).toBe(2);
  const playback = await page.evaluate(async () => {
    const api = (window as any).__scratchyBoards;
    const { board } = await api.initBoards();
    const [take] = await api.listTakes(board.id);
    const url = URL.createObjectURL(take.blob);
    const video = document.createElement('video');
    video.src = url; video.muted = true; video.playsInline = true;
    document.body.append(video);
    try {
      await video.play();
      const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
      video.currentTime = 0.5;
      await seeked;
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    } finally {
      video.pause(); video.remove(); URL.revokeObjectURL(url);
    }
  });
  expect(playback).toEqual({ duration: 1.5, width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Undo video edit', exact: true }).click();
  const withAudioDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  const withAudio = await inspect(await withAudioDownload);
  expect(withAudio.audio).toBe(1);
  expect(withAudio.duration).toBeCloseTo(1.5, 1);
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', originalUrl!);
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await page.getByRole('button', { name: 'Saved takes', exact: true }).click();
  await page.locator('.take-open').click();
  await page.getByRole('button', { name: 'Edit a copy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit a saved take' })).toBeVisible();
  await page.getByRole('button', { name: 'Save copy to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved to library ✓' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await expect(page.locator('.take-row')).toHaveCount(2);
});

test('WebM edits preserve audio and export a playable seekable range', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported = (mime) => mime.startsWith('video/webm') && supported(mime);
  });
  await openStudio(page);
  await page.getByRole('button', { name: 'Enable microphone (M)' }).click();
  await expect(page.getByRole('button', { name: 'Turn microphone off (M)' })).toBeVisible();
  await record(page, 3);
  await expect(page.locator('.modal-meta')).toContainText('video/webm');
  await page.getByLabel('Trim start', { exact: true }).fill('0.25');
  await page.getByLabel('Trim end', { exact: true }).fill('1.75');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  const info = await inspect(await download);
  // WebM packet scans omit the held final frame; its declared duration is
  // authoritative for playback, while packets must end within one frame.
  expect(info.metadataDuration).toBeCloseTo(1.5, 3);
  expect(Math.abs(info.duration - 1.5)).toBeLessThanOrEqual(1 / 30);
  expect(info.audio).toBe(1);
  expect(info.firstTimestamp).toBeLessThan(0.05);
});

test('a failed library save reports storage trouble without discarding the take', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  await record(page, 1);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'takes') throw new DOMException('Storage full', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Device storage may be full');
  await expect(page.getByRole('button', { name: 'Save failed. Retry?', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});

test('unsupported edited export reports an error and leaves the original intact', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  await record(page, 2);
  await page.evaluate(() => {
    VideoEncoder.isConfigSupported = async (config) => ({ supported: false, config });
  });

  await page.getByLabel('Trim start', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cannot encode this edit');
  await expect(page.locator('.modal-video')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download edited video', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});

test('cancelling an export preserves the chosen edit and allows a successful retry', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  await record(page, 2);
  await page.evaluate(() => {
    const supported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (config) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return supported(config);
    };
  });
  await page.getByLabel('Trim start', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Export cancelled');
  await expect(page.getByLabel('Trim start', { exact: true })).toHaveValue('0.5');
  await expect(page.getByRole('link', { name: 'Download original', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  const info = await inspect(await download);
  expect(info.duration).toBeGreaterThan(1);
});

test('a stalled encoder returns control with an error instead of trapping the editor', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  await record(page, 1);
  await page.evaluate(() => {
    VideoEncoder.prototype.flush = () => new Promise<void>(() => {});
  });
  await page.getByLabel('Trim start', { exact: true }).fill('0.25');
  await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('encoder stopped responding', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Download edited video', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Download original', exact: true })).toBeVisible();
});

test('video edit keyboard undo is isolated from board shortcuts and unsaved edits need confirmation', async ({ page }) => {
  await seed(page);
  await openStudio(page);
  const board = await page.locator('.stage-input').boundingBox();
  if (!board) throw new Error('No drawing board');
  await page.mouse.move(board.x + board.width * 0.3, board.y + board.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width * 0.6, board.y + board.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await record(page, 2);
  await page.getByLabel('Trim start', { exact: true }).fill('0.5');
  await page.getByRole('heading', { name: 'Your take is ready' }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Trim start', { exact: true })).toHaveValue('0');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByLabel('Trim start', { exact: true })).toHaveValue('0.5');
  expect(await page.evaluate(() => (window as any).__scratchy.engine.getElements().length)).toBe(1);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard }));
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).__scratchy.engine.getElements().length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText('not been exported');
  await page.getByRole('button', { name: 'Discard edits and go back', exact: true }).click();
  await expect(page.locator('.modal-scrim')).toBeHidden();
});

test('video processing is lazy and the compositor does not draw above the target frame rate', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await seed(page);
  await openStudio(page);
  expect(requests.some((url) => url.includes('mediabunny'))).toBe(false);
  const frames = await page.evaluate(async () => {
    const { Compositor } = await import('/src/recording/Compositor.ts');
    const { presetById } = await import('/src/recording/presets.ts');
    const compositor = new Compositor({
      getBackground: () => 'white', getInkCanvas: () => null, getActiveElement: () => null,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getLaserTrail: () => [],
      getVideo: () => null, getCutoutCanvas: () => null,
      getCameraLayout: () => ({ x: 0, y: 0, width: 100, height: 100, shape: 'circle', mirrored: false }),
    }, presetById('compat'), { w: 1280, h: 720 });
    const ctx = compositor.canvas.getContext('2d')!;
    let count = 0;
    const fill = ctx.fillRect.bind(ctx);
    ctx.fillRect = (...args) => { count++; fill(...args); };
    compositor.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    compositor.stop();
    return count;
  });
  expect(frames).toBeGreaterThan(10);
  expect(frames).toBeLessThanOrEqual(34);
});

test.describe('touch presenter workspace', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('camera controls keep full-size touch targets when the stage shrinks for notes', async ({ page }) => {
    await seed(page);
    await openStudio(page);
    await page.getByRole('button', { name: 'More controls', exact: true }).click();
    await page.getByRole('button', { name: 'Enable camera (C)', exact: true }).click();
    await expect(page.locator('.camera-overlay')).toBeVisible();
    await page.getByRole('button', { name: 'More controls', exact: true }).click();
    await page.getByRole('button', { name: 'Presenter notes', exact: true }).click();
    await page.getByLabel('Notes script').fill('Leave enough space to draw.');
    for (const button of await page.locator('.cam-btn').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(43.5);
      expect(bounds!.height).toBeGreaterThanOrEqual(43.5);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    }
    await page.getByRole('button', { name: 'Rounded camera', exact: true }).click();
    await page.getByRole('button', { name: 'Mirror camera', exact: true }).click();
    await page.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await expect(page.locator('.camera-overlay')).toBeHidden();
  });

  test('phone and tablet controls stay reachable, focus expands the stage, and notes do not overflow', async ({ page }) => {
    await seed(page);
    await openStudio(page);
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.getByRole('button', { name: 'More controls', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Import image or PDF', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export image', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'More controls', exact: true }).click();
      const before = await page.locator('.stage').boundingBox();
      await page.getByRole('button', { name: 'Enter focus mode', exact: true }).click();
      const stage = await page.locator('.stage').boundingBox();
      expect(stage!.x).toBeGreaterThanOrEqual(0);
      expect(stage!.x + stage!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(stage!.y + stage!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(stage!.width * stage!.height).toBeGreaterThanOrEqual(before!.width * before!.height);
      await page.getByRole('button', { name: 'Presenter notes', exact: true }).click();
      const notes = await page.getByRole('complementary', { name: 'Presenter notes' }).boundingBox();
      expect(notes!.x).toBeGreaterThanOrEqual(0);
      expect(notes!.x + notes!.width).toBeLessThanOrEqual(viewport.width);
      await page.getByLabel('Notes script').fill('Private notes on a small screen');
      await page.getByRole('button', { name: 'Read notes', exact: true }).click();
      const reader = await page.locator('.notes-reader').boundingBox();
      expect(reader!.height).toBeGreaterThanOrEqual(72);
      await page.getByRole('button', { name: 'Close presenter notes' }).click();
      await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click();
    }
  });

  test('phone recording controls fit at 320px when running and paused', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await seed(page);
    await openStudio(page);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await page.waitForTimeout(300);
    for (const paused of [false, true]) {
      if (paused) await page.getByRole('button', { name: 'Pause recording (Space)' }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      for (const name of ['Presenter notes', 'Exit focus mode', 'Stop recording']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      }
    }
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await expect(page.locator('.modal-video')).toBeVisible();
  });

  test('recording enters focus on a phone; stop and the scrollable editor fit a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await seed(page);
    await openStudio(page);
    await record(page, 2);
    await expect(page.locator('.app')).toHaveClass(/is-focused/);
    const modal = await page.locator('.video-editor').boundingBox();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(320);
    expect(modal!.y + modal!.height).toBeLessThanOrEqual(568);
    await page.getByLabel('Trim start', { exact: true }).fill('0.5');
    await page.getByLabel('Trim end', { exact: true }).fill('1.5');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download edited video', exact: true }).click();
    const edited = await inspect(await download);
    expect(edited.duration).toBeCloseTo(1, 2);
    expect(edited.width).toBe(1080);
    expect(edited.height).toBe(1920);
    await page.getByRole('button', { name: 'Back to board', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit focus mode', exact: true })).toBeVisible();
  });
});
