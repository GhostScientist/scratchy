/**
 * Capability probe (SPEC §9): cheap feature checks first, then a short real
 * MediaRecorder smoke test, then a separate pause/resume reliability run,
 * then a performance probe that gates the 1080p preset. Runs lazily on the
 * first Record tap and is cached as a DeviceProfile; failures are never
 * cached.
 *
 * Only missing APIs hard-block recording. A smoke test that produces no
 * data demotes to a warning + compatibility mode instead — the probe is a
 * simulation, and a false negative must not lock out recording that would
 * actually work (the real recorder has its own error handling).
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

interface ShortRecordingResult {
  blob: Blob;
  /** Data arrived after resume — the pause/resume cycle kept recording. */
  dataAfterResume: boolean;
  pauseThrew: boolean;
}

/** One bounded MediaRecorder run against an existing stream. Never rejects;
 *  a broken recorder just resolves with an empty blob. */
function runShortRecording(
  stream: MediaStream,
  mimeType: string,
  opts: { timeslice?: number; pauseResume?: boolean },
): Promise<ShortRecordingResult> {
  return new Promise((resolve) => {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        resolve({ blob: new Blob([]), dataAfterResume: false, pauseThrew: true });
        return;
      }
    }
    const chunks: Blob[] = [];
    let resumed = false;
    let dataAfterResume = false;
    let pauseThrew = false;
    let settled = false;
    let graceTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardStop);
      window.clearTimeout(graceTimer);
      resolve({
        blob: new Blob(chunks, { type: recorder.mimeType || mimeType }),
        dataAfterResume,
        pauseThrew,
      });
    };
    recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      chunks.push(e.data);
      if (resumed) dataAfterResume = true;
    };
    // Give a trailing dataavailable a beat to land after onstop.
    recorder.onstop = () => window.setTimeout(finish, 50);
    // Backstop for engines that never fire onstop on canvas streams.
    const hardStop = window.setTimeout(finish, 6000);

    void (async () => {
      try {
        if (opts.timeslice) recorder.start(opts.timeslice);
        else recorder.start();
      } catch {
        finish();
        return;
      }
      await delay(350);
      if (opts.pauseResume) {
        try {
          recorder.pause();
          await delay(150);
          recorder.resume();
          resumed = true;
        } catch {
          pauseThrew = true;
        }
      }
      await delay(400);
      try {
        recorder.requestData();
      } catch {
        // Nothing pending / recorder never really started.
      }
      try {
        recorder.stop();
      } catch {
        finish();
        return;
      }
      graceTimer = window.setTimeout(finish, 4000);
    })();
  });
}

interface SmokeOutcome {
  /** A plain recording produced data. */
  ok: boolean;
  /** The produced blob parsed as playable media. */
  playable: boolean;
  pauseReliable: boolean;
}

/** Short off-screen canvas recording. Basic capability is judged from a
 *  plain run first — a wedged pause() must read as "pause unreliable", not
 *  "cannot record". */
async function smokeTest(format: NegotiatedFormat): Promise<SmokeOutcome> {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, playable: false, pauseReliable: false };

  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0] ?? null;

  // Keep the canvas changing AND force frame delivery — the probe canvas is
  // detached from the DOM, and some engines only emit captureStream frames
  // via requestFrame (the recording compositor does the same).
  let hue = 0;
  let raf = 0;
  const paint = () => {
    hue = (hue + 11) % 360;
    ctx.fillStyle = `hsl(${hue} 60% 55%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (track && 'requestFrame' in track) {
      (track as CanvasCaptureMediaStreamTrack).requestFrame();
    }
    raf = requestAnimationFrame(paint);
  };
  paint();
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
  };

  // 1. Basic capability: a plain timesliced run, then a no-timeslice retry —
  //    some engines only deliver data at stop when started without one.
  let basic = await runShortRecording(stream, format.mimeType, { timeslice: 200 });
  if (basic.blob.size === 0) {
    basic = await runShortRecording(stream, format.mimeType, {});
  }
  if (basic.blob.size === 0) {
    cleanup();
    return { ok: false, playable: false, pauseReliable: false };
  }
  const playable = await canPlay(basic.blob);

  // 2. Pause/resume reliability, isolated in its own run.
  const pauseRun = await runShortRecording(stream, format.mimeType, {
    timeslice: 150,
    pauseResume: true,
  });
  cleanup();
  return {
    ok: true,
    playable,
    pauseReliable: !pauseRun.pauseThrew && pauseRun.blob.size > 0 && pauseRun.dataAfterResume,
  };
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
      reason: 'Recording needs a secure (HTTPS) connection. Open the app over https://.',
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
    warnings.push('Camera and microphone are unavailable here, so recordings will be silent.');
  }

  const storageAdapter: DeviceProfile['storageAdapter'] = idbAvailable() ? 'idb' : 'memory';
  if (storageAdapter === 'memory') {
    warnings.push('IndexedDB is unavailable, so long recordings stay in memory only.');
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
    // The probe is a simulation — warn and fall back to compatibility mode
    // rather than blocking a recording that may work for real.
    warnings.unshift(
      'A quick device check could not produce a test recording. Recording may not work in this browser, but you can try.',
    );
  } else if (!smoke.playable) {
    warnings.push(
      'The test recording did not play back cleanly, so exported files may not play in this browser.',
    );
  }
  if (smoke.ok && !smoke.pauseReliable) {
    warnings.push('Pause/resume is unreliable in this browser, so the pause control is hidden.');
  }

  const fastEnough = smoke.ok ? await performanceProbe() : false;

  const profile: DeviceProfile = {
    version: 1,
    userAgent: navigator.userAgent,
    mimeType: format.mimeType,
    extension: format.extension,
    smokeOk: smoke.ok,
    supports1080p: fastEnough,
    supportsVertical: fastEnough,
    storageAdapter,
    pauseReliable: smoke.pauseReliable,
    storageEstimate,
    lastProbeAt: Date.now(),
    warnings,
  };
  // A failed smoke test is never cached — the next Record tap re-checks.
  if (smoke.ok) saveDeviceProfile(profile);
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
