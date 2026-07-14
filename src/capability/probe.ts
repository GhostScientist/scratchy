/**
 * Capability probe (SPEC §9): cheap feature checks first, then a short real
 * MediaRecorder smoke test (which also exercises pause/resume), then a
 * performance probe that gates the 1080p preset. Runs lazily on the first
 * Record tap and is cached as a DeviceProfile; failures are never cached.
 */

import { negotiateFormat } from '../recording/mime';
import type { NegotiatedFormat } from '../recording/mime';
import { idbAvailable } from '../persistence/db';
import {
  loadDeviceProfile,
  saveDeviceProfile,
  profileIsFresh,
} from './profile';
import type { DeviceProfile, ProbeResult } from './profile';

const SMOKE_TIMESLICE_MS = 150;
const PLAYBACK_TIMEOUT_MS = 4000;
/** Median compositor-frame budget for 1080p at 30fps, leaving encoder headroom. */
const FRAME_BUDGET_MS = 8;
const PERF_FRAMES = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The finished blob must at least parse as media — loadedmetadata without
 *  an error is the signal (duration is often Infinity for streamed webm). */
function canPlay(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), PLAYBACK_TIMEOUT_MS);
    video.onloadedmetadata = () => done(true);
    video.onerror = () => done(false);
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
  });
}

interface SmokeOutcome {
  ok: boolean;
  pauseReliable: boolean;
  reason?: string;
}

/** ~1s off-screen canvas recording that exercises start → pause → resume →
 *  stop and verifies the result plays. */
async function smokeTest(format: NegotiatedFormat): Promise<SmokeOutcome> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, pauseReliable: false, reason: 'Canvas 2D is not available.' };

  // Keep the canvas changing so captureStream actually produces frames.
  let hue = 0;
  let raf = 0;
  const paint = () => {
    hue = (hue + 11) % 360;
    ctx.fillStyle = `hsl(${hue} 60% 55%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    raf = requestAnimationFrame(paint);
  };
  paint();

  const stream = canvas.captureStream(30);
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
  };

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      cleanup();
      return {
        ok: false,
        pauseReliable: false,
        reason: 'The recorder could not be initialized in this browser.',
      };
    }
  }

  const chunks: Blob[] = [];
  let resumed = false;
  let dataAfterResume = false;
  recorder.ondataavailable = (e: BlobEvent) => {
    if (!e.data || e.data.size === 0) return;
    chunks.push(e.data);
    if (resumed) dataAfterResume = true;
  };

  let pauseWorked = false;
  try {
    recorder.start(SMOKE_TIMESLICE_MS);
    await delay(350);
    try {
      recorder.pause();
      await delay(150);
      recorder.resume();
      resumed = true;
      pauseWorked = true;
      await delay(400);
    } catch {
      pauseWorked = false;
      await delay(400);
    }
  } catch {
    cleanup();
    return { ok: false, pauseReliable: false, reason: 'A test recording failed to start.' };
  }

  await new Promise<void>((resolve) => {
    const finish = window.setTimeout(resolve, 1500);
    recorder.onstop = () => {
      window.clearTimeout(finish);
      resolve();
    };
    try {
      recorder.requestData();
    } catch {
      // Nothing pending.
    }
    try {
      recorder.stop();
    } catch {
      window.clearTimeout(finish);
      resolve();
    }
  });
  cleanup();

  const blob = new Blob(chunks, { type: recorder.mimeType || format.mimeType });
  if (blob.size === 0) {
    return {
      ok: false,
      pauseReliable: false,
      reason: 'A test recording produced no data — this browser cannot record a canvas.',
    };
  }
  if (!(await canPlay(blob))) {
    return {
      ok: false,
      pauseReliable: false,
      reason: 'A test recording could not be played back — the produced format is broken here.',
    };
  }
  return { ok: true, pauseReliable: pauseWorked && dataAfterResume };
}

/** Times 1080p-scale compositor work (clear + 2× ink-cache downscale blit).
 *  Vertical (1080×1920) is the same pixel count, so one probe gates both. */
function performanceProbe(): Promise<boolean> {
  return new Promise((resolve) => {
    const out = document.createElement('canvas');
    out.width = 1920;
    out.height = 1080;
    const ctx = out.getContext('2d');
    const src = document.createElement('canvas');
    src.width = 2560;
    src.height = 1440;
    const srcCtx = src.getContext('2d');
    if (!ctx || !srcCtx) {
      resolve(false);
      return;
    }
    srcCtx.fillStyle = '#334';
    srcCtx.fillRect(0, 0, src.width, src.height);

    const times: number[] = [];
    let frames = 0;
    const tick = () => {
      const t0 = performance.now();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, out.width, out.height);
      times.push(performance.now() - t0);
      frames += 1;
      if (frames < PERF_FRAMES) {
        requestAnimationFrame(tick);
      } else {
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)];
        resolve(median < FRAME_BUDGET_MS);
      }
    };
    requestAnimationFrame(tick);
  });
}

export async function runCapabilityProbe(): Promise<ProbeResult> {
  const warnings: string[] = [];

  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: 'Recording needs a secure (HTTPS) connection — open the app over https://.',
    };
  }
  if (typeof PointerEvent === 'undefined') {
    return { ok: false, reason: 'This browser lacks pointer-input support and cannot run the studio.' };
  }
  const canvasCheck = document.createElement('canvas');
  if (!canvasCheck.getContext('2d')) {
    return { ok: false, reason: "This browser can't draw to a canvas, so there is nothing to record." };
  }
  if (typeof canvasCheck.captureStream !== 'function') {
    return {
      ok: false,
      reason: "This browser can't capture a canvas as video (captureStream is missing).",
    };
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      ok: false,
      reason:
        "This browser can't record video (MediaRecorder is missing). Try a current version of Chrome, Edge, or Safari.",
    };
  }
  const format = negotiateFormat();
  if (!format) {
    return {
      ok: false,
      reason:
        "This browser can't record video (no supported recording format). Try a current version of Chrome, Edge, or Safari.",
    };
  }

  if (!navigator.mediaDevices) {
    warnings.push('Camera and microphone are unavailable here — recordings will be silent.');
  }

  const storageAdapter: DeviceProfile['storageAdapter'] = idbAvailable() ? 'idb' : 'memory';
  if (storageAdapter === 'memory') {
    warnings.push('IndexedDB is unavailable — long recordings stay in memory only.');
  }

  let storageEstimate: DeviceProfile['storageEstimate'] = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) storageEstimate = { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    // Estimate is a nicety only.
  }

  const smoke = await smokeTest(format);
  if (!smoke.ok) {
    return { ok: false, reason: smoke.reason ?? 'A test recording failed.' };
  }
  if (!smoke.pauseReliable) {
    warnings.push('Pause/resume is unreliable in this browser — the pause control is hidden.');
  }

  const fastEnough = await performanceProbe();

  const profile: DeviceProfile = {
    version: 1,
    userAgent: navigator.userAgent,
    mimeType: format.mimeType,
    extension: format.extension,
    supports1080p: fastEnough,
    supportsVertical: fastEnough,
    storageAdapter,
    pauseReliable: smoke.pauseReliable,
    storageEstimate,
    lastProbeAt: Date.now(),
    warnings,
  };
  saveDeviceProfile(profile);
  return { ok: true, profile };
}

/** Cached profile when fresh; otherwise run the probe. Failures aren't cached. */
export async function ensureDeviceProfile(force = false): Promise<ProbeResult> {
  if (!force) {
    const cached = loadDeviceProfile();
    if (cached && profileIsFresh(cached)) return { ok: true, profile: cached };
  }
  return runCapabilityProbe();
}
