import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __screenTest: {
      streams: MediaStream[];
      requests: DisplayMediaStreamOptions[];
      fail: string | null;
      recorded: MediaStream | null;
      setColor(color: string): void;
    };
  }
}

async function seed(page: Page, countdownSeconds = 0, provideAudio = false, floating = false) {
  await page.addInitScript(({ countdownSeconds, provideAudio, floating }) => {
    localStorage.setItem('scratchy.settings.v1', JSON.stringify({
      handedness: 'right', presetId: 'compat', countdownSeconds,
    }));
    localStorage.setItem('scratchy.deviceProfile.v1', JSON.stringify({
      version: 1, userAgent: navigator.userAgent, mimeType: 'video/webm', extension: '.webm',
      smokeOk: true, supports1080p: true, supportsVertical: true, storageAdapter: 'idb',
      pauseReliable: true, storageEstimate: null, lastProbeAt: Date.now(), warnings: [],
    }));
    let color = '#00be5a';
    const paints: (() => void)[] = [];
    window.__screenTest = {
      streams: [], requests: [], fail: null, recorded: null,
      setColor: (next) => { color = next; paints.forEach((paint) => paint()); },
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true,
      value: async (options: DisplayMediaStreamOptions) => {
        window.__screenTest.requests.push(options);
        if (window.__screenTest.fail) throw new DOMException('Picker rejected', window.__screenTest.fail);
        const canvas = document.createElement('canvas');
        canvas.width = 960; canvas.height = 720;
        const context = canvas.getContext('2d')!;
        const paint = () => {
          context.fillStyle = color;
          context.fillRect(0, 0, 960, 720);
          context.fillStyle = '#ff2020';
          context.fillRect(0, 0, 40, 720);
          context.fillRect(920, 0, 40, 720);
        };
        paints.push(paint);
        paint();
        const stream = canvas.captureStream(30);
        const timer = setInterval(paint, 33);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        if (provideAudio && options.audio) {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          oscillator.frequency.value = 440;
          const destination = audio.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
        }
        window.__screenTest.streams.push(stream);
        return stream;
      },
    });
    const Original = window.MediaRecorder;
    window.MediaRecorder = new Proxy(Original, {
      construct(target, args) {
        window.__screenTest.recorded = args[0] as MediaStream;
        return Reflect.construct(target, args);
      },
    });
    if (floating) {
      Object.defineProperty(window, 'documentPictureInPicture', {
        value: { requestWindow: async () => window.open('about:blank', '', 'width=380,height=300') },
        configurable: true,
      });
    }
  }, { countdownSeconds, provideAudio, floating });
}

async function openScreenStudio(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.boards-menu');
  await page.getByRole('button', { name: 'Screen mode', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
}

async function share(page: Page) {
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
}

async function start(page: Page) {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
}

async function stop(page: Page) {
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
}

async function framePixels(page: Page, positions: number[][]) {
  await page.waitForFunction(() =>
    (document.querySelector('.modal-video') as HTMLVideoElement)?.readyState >= 2);
  return page.locator('.modal-video').evaluate(async (node, positions) => {
    const video = node as HTMLVideoElement;
    video.pause();
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      video.currentTime = 0.3;
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(video, 0, 0);
    return {
      width: video.videoWidth, height: video.videoHeight,
      pixels: positions.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)),
    };
  }, positions);
}

test('unsupported browsers disable Screen mode and explain on hover and focus', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined });
  });
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Screen mode', exact: true });
  await expect(button).toBeDisabled();
  await page.locator('.screen-mode-control').hover();
  await expect(page.getByRole('tooltip')).toContainText('unavailable in this browser');
  await page.mouse.move(0, 0);
  await page.locator('.screen-mode-control').focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
});

test('missing encoder and insecure contexts also disable Screen mode', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Screen mode', exact: true })).toBeDisabled();
  await page.locator('.screen-mode-control').hover();
  await expect(page.getByRole('tooltip')).toContainText('cannot record screen video');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
  });
  await page.reload();
  await page.locator('.screen-mode-control').hover();
  await expect(page.getByRole('tooltip')).toContainText('HTTPS or localhost');
});

test('screen studio has no board tools and only requests sharing on an explicit tap', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  expect(await page.evaluate(() => window.__screenTest.requests.length)).toBe(0);
  await expect(page.getByLabel('Lesson drawing surface')).toBeHidden();
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toHaveCount(0);
  await expect(page.locator('.page-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable camera (C)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable microphone (M)' })).toBeVisible();
  await share(page);
  expect(await page.evaluate(() => window.__screenTest.requests[0].audio)).toBe(false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vertical preset' })).toHaveCount(0);
});

test('picker cancellation is explicit and a cancelled replacement retains the previous source', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  await page.evaluate(() => { window.__screenTest.fail = 'NotAllowedError'; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('cancelled or blocked');
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.__screenTest.fail = null; });
  await share(page);
  await page.evaluate(() => { window.__screenTest.fail = 'NotReadableError'; });
  await page.getByRole('button', { name: 'Change screen', exact: true }).click();
  await expect(page.locator('.toast').last()).toContainText('operating system');
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__screenTest.streams[0].getVideoTracks()[0].readyState)).toBe('live');
});

test('records the entire source without cropping or board/UI content, then releases capture', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  await share(page);
  await start(page);
  await expect(page.getByRole('button', { name: 'Change screen', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back to whiteboard', exact: true })).toBeDisabled();
  await page.waitForTimeout(1500);
  await stop(page);
  const output = await framePixels(page, [[80, 360], [180, 360], [640, 360], [1100, 360]]);
  expect([output.width, output.height]).toEqual([1280, 720]);
  expect(Math.max(...output.pixels[0])).toBeLessThan(35);
  expect(output.pixels[1][0]).toBeGreaterThan(230);
  expect(output.pixels[3][0]).toBeGreaterThan(230);
  expect(output.pixels[2][0]).toBeLessThan(15);
  expect(output.pixels[2][1]).toBeGreaterThan(175);
  expect(await page.evaluate(() => window.__screenTest.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved to library', exact: false })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to board', exact: true }).click();
  await page.getByRole('button', { name: 'Saved takes', exact: true }).click();
  await expect(page.locator('.take-row')).toHaveCount(1);
});

test('camera overlays are encoded over the screen, with separate whiteboard placement', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  await share(page);
  await page.getByRole('button', { name: 'Enable camera (C)' }).click();
  await page.waitForFunction(() => (document.querySelector('.cam-frame video') as HTMLVideoElement)?.readyState >= 2);
  const initial = await page.locator('.camera-overlay').evaluate((node) => (node as HTMLElement).style.left);
  const overlay = await page.locator('.camera-overlay').boundingBox();
  if (!overlay) throw new Error('Camera overlay missing');
  await page.mouse.move(overlay.x + 40, overlay.y + 40);
  await page.mouse.down();
  await page.mouse.move(overlay.x - 300, overlay.y - 180);
  await page.mouse.up();
  const layout = await page.locator('.camera-overlay').evaluate((node) => ({
    x: parseFloat((node as HTMLElement).style.left), y: parseFloat((node as HTMLElement).style.top),
  }));
  await start(page);
  await page.waitForTimeout(1200);
  await stop(page);
  const output = await framePixels(page, [[layout.x + 100, layout.y + 70], [640, 100]]);
  expect(output.pixels[0].some((value, index) => Math.abs(value - [0, 190, 90][index]) > 30)).toBe(true);
  expect(output.pixels[1][1]).toBeGreaterThan(175);
  await page.getByRole('button', { name: 'Delete take', exact: true }).click();
  await page.getByRole('button', { name: 'Really delete?', exact: true }).click();
  await page.getByRole('button', { name: 'Back to whiteboard', exact: true }).click();
  await expect(page.locator('.camera-overlay')).toHaveCSS('left', initial);
});

test('1080p screen quality does not change the whiteboard preset or its ink', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.waitForSelector('.boards-menu');
  const board = await page.getByLabel('Lesson drawing surface').boundingBox();
  if (!board) throw new Error('Drawing surface missing');
  await page.mouse.move(board.x + 100, board.y + 100);
  await page.mouse.down();
  await page.mouse.move(board.x + 300, board.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Screen mode', exact: true }).click();
  await share(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: '1080p preset', exact: true }).click();
  await page.locator('.screen-source-info').click();
  await start(page);
  await page.waitForTimeout(1200);
  await stop(page);
  const frame = await framePixels(page, [[960, 540]]);
  expect([frame.width, frame.height]).toEqual([1920, 1080]);
  expect(frame.pixels[0][1]).toBeGreaterThan(175);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('scratchy.settings.v1')!).presetId)).toBe('compat');
  await page.getByRole('button', { name: 'Delete take', exact: true }).click();
  await page.getByRole('button', { name: 'Really delete?', exact: true }).click();
  await page.getByRole('button', { name: 'Back to whiteboard', exact: true }).click();
  const darkPixels = await page.locator('.board-stage-layers canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 100) pixels++;
    return pixels;
  });
  expect(darkPixels).toBeGreaterThan(100);
});

test('moving the camera mid-take stays live across recording timer renders', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  await share(page);
  await page.getByRole('button', { name: 'Enable camera (C)' }).click();
  await page.waitForFunction(() => (document.querySelector('.cam-frame video') as HTMLVideoElement)?.readyState >= 2);
  await start(page);
  const bubble = await page.locator('.camera-overlay').boundingBox();
  if (!bubble) throw new Error('Camera missing');
  await page.mouse.move(bubble.x + 50, bubble.y + 50);
  await page.mouse.down();
  await page.mouse.move(bubble.x - 300, bubble.y - 180);
  await page.waitForTimeout(800);
  const pixel = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('.camera-overlay')!;
    const track = window.__screenTest.recorded!.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    return [...track.canvas.getContext('2d')!.getImageData(
      parseFloat(overlay.style.left) + 100, parseFloat(overlay.style.top) + 70, 1, 1,
    ).data].slice(0, 3);
  });
  expect(pixel.some((value, index) => Math.abs(value - [0, 190, 90][index]) > 30)).toBe(true);
  await page.mouse.up();
  await stop(page);
});

test('browser Stop sharing finalizes a paused take and stops every source track', async ({ page }) => {
  await seed(page, 0, true);
  await openScreenStudio(page);
  await page.getByLabel('Request shared audio', { exact: true }).check();
  await share(page);
  await start(page);
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Pause recording (Space)' }).click();
  await page.evaluate(() => {
    const track = window.__screenTest.streams[0].getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => window.__screenTest.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});

test('sharing ended during countdown never starts a late recording', async ({ page }) => {
  await seed(page, 3);
  await openScreenStudio(page);
  await share(page);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('.countdown-num')).toHaveText('3');
  await page.evaluate(() => {
    const track = window.__screenTest.streams[0].getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await expect(page.locator('.toast').last()).toContainText('countdown was cancelled');
  await page.waitForTimeout(3300);
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  await expect(page.locator('.modal-video')).toHaveCount(0);
  expect(await page.evaluate(() => window.__screenTest.recorded)).toBeNull();
});

test('missing shared audio is visible and leaving screen mode releases capture', async ({ page }) => {
  await seed(page);
  await openScreenStudio(page);
  await page.getByLabel('Request shared audio', { exact: true }).check();
  await share(page);
  await expect(page.locator('.screen-audio-warning')).toContainText('did not provide audio');
  expect(await page.evaluate(() => window.__screenTest.requests[0].audio)).toBe(true);
  await page.getByRole('button', { name: 'Back to whiteboard', exact: true }).click();
  expect(await page.evaluate(() => window.__screenTest.streams[0].getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.getByLabel('Lesson drawing surface')).toBeVisible();
});

test('shared audio and microphone mix into one track; mic muting leaves shared sound audible', async ({ page }) => {
  await seed(page, 0, true);
  await openScreenStudio(page);
  await page.getByLabel('Request shared audio', { exact: true }).check();
  await share(page);
  await page.getByRole('button', { name: 'Enable microphone (M)' }).click();
  await expect(page.getByRole('button', { name: 'Turn microphone off (M)' })).toBeVisible();
  await start(page);
  expect(await page.evaluate(() => window.__screenTest.recorded?.getAudioTracks().length)).toBe(1);
  await page.getByRole('button', { name: 'Mute microphone (M)' }).click();
  const rms = await page.evaluate(async () => {
    const audio = new AudioContext();
    await audio.resume();
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(window.__screenTest.recorded!).connect(analyser);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    await audio.close();
    return rms;
  });
  expect(rms).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => window.__screenTest.recorded?.getAudioTracks()[0].enabled)).toBe(true);
  await page.waitForTimeout(1000);
  await stop(page);
});

test('an unavailable audio mixer reports an error instead of silently losing shared sound', async ({ page }) => {
  await seed(page, 0, true);
  await openScreenStudio(page);
  await page.getByLabel('Request shared audio', { exact: true }).check();
  await share(page);
  await page.getByRole('button', { name: 'Enable microphone (M)' }).click();
  await expect(page.getByRole('button', { name: 'Turn microphone off (M)' })).toBeVisible();
  await page.evaluate(() => {
    AudioContext.prototype.resume = () => new Promise<void>(() => {});
  });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.locator('.toast').last()).toContainText('audio mixer', { timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__screenTest.recorded)).toBeNull();
  expect(await page.evaluate(() => window.__screenTest.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});

test('floating controls render the actual compositor and remain usable away from the studio', async ({ page }) => {
  await seed(page, 0, false, true);
  await openScreenStudio(page);
  await share(page);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Floating controls', exact: true }).click();
  const popup = await popupPromise;
  await popup.getByRole('button', { name: 'Record screen', exact: true }).click();
  await expect(popup.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect(popup.locator('.floating-preview canvas')).toBeVisible();
  await popup.bringToFront();
  await page.evaluate(() => window.__screenTest.setColor('#2020ff'));
  await expect.poll(() => popup.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(640, 100, 1, 1).data[2])).toBeGreaterThan(230);
  await popup.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(popup.getByRole('status').first()).toHaveText('Paused');
  await popup.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(1200);
  await popup.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await popup.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.locator('.modal-video')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => popup.isClosed()).toBe(true);
});
