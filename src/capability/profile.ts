/**
 * Device capability profile (SPEC §9). Cached in localStorage — same
 * rationale as settings: synchronous, tiny, and independent of IndexedDB.
 * The profile is never treated as permanent truth: it is re-probed when the
 * browser changes (user agent) or goes stale.
 */

export interface DeviceProfile {
  version: 1;
  userAgent: string;
  /** Negotiated recording container/codec, e.g. video/webm;codecs=... */
  mimeType: string;
  extension: string;
  /** The smoke recording produced data. false = compatibility mode, uncached. */
  smokeOk: boolean;
  supports1080p: boolean;
  supportsVertical: boolean;
  storageAdapter: 'idb' | 'memory';
  pauseReliable: boolean;
  storageEstimate: { usage: number; quota: number } | null;
  lastProbeAt: number;
  warnings: string[];
}

export type ProbeResult = { ok: true; profile: DeviceProfile } | { ok: false; reason: string };

const KEY = 'scratchy.deviceProfile.v1';
const MAX_PROFILE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function loadDeviceProfile(): DeviceProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceProfile;
    if (parsed.version !== 1 || typeof parsed.mimeType !== 'string') return null;
    // Profiles are only ever cached after a passing smoke test; older
    // profiles predate the field.
    return { ...parsed, smokeOk: parsed.smokeOk ?? true };
  } catch {
    return null;
  }
}

export function saveDeviceProfile(profile: DeviceProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // A full disk just means we re-probe next time.
  }
}

export function profileIsFresh(profile: DeviceProfile): boolean {
  return (
    profile.userAgent === navigator.userAgent &&
    Date.now() - profile.lastProbeAt < MAX_PROFILE_AGE_MS
  );
}
