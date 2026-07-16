/**
 * Coarse device performance tier. 'low' relaxes rendering quality knobs
 * (backing resolution cap, camera capture size, segmentation rate) so budget
 * tablets and Chromebooks stay smooth; 'high' keeps today's behavior.
 *
 * Synchronous and module-cached so hot paths can read it at construction
 * time without waiting on the async recording probe.
 */

import { loadDeviceProfile } from './profile';

export type PerfTier = 'high' | 'low';

const OVERRIDE_KEY = 'scratchy.perfTier';

let cached: PerfTier | null = null;

export function detectPerfTier(): PerfTier {
  if (cached) return cached;
  cached = compute();
  return cached;
}

/** Test/support escape hatch: pin the tier and clear the cache. */
export function overridePerfTier(tier: PerfTier | null): void {
  try {
    if (tier) localStorage.setItem(OVERRIDE_KEY, tier);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // Storage unavailable — the in-memory cache below still applies.
  }
  cached = tier;
}

function compute(): PerfTier {
  try {
    const forced = localStorage.getItem(OVERRIDE_KEY);
    if (forced === 'low' || forced === 'high') return forced;
  } catch {
    // Ignore storage failures and fall through to detection.
  }

  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 4) return 'low';
  // deviceMemory is Chromium-only; elsewhere fall back to core count.
  if (memory === undefined && navigator.hardwareConcurrency <= 4) return 'low';

  // A device that failed the 1080p blit probe has already demonstrated a
  // weak GPU, whatever its RAM/core count claims.
  const profile = loadDeviceProfile();
  if (profile && profile.smokeOk && profile.supports1080p === false) return 'low';

  return 'high';
}
