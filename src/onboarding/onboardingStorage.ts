/**
 * One-time welcome tour persistence. A standalone versioned localStorage key
 * (not part of AppSettings) so seeding or migrating settings never re-triggers
 * the tour; bumping ONBOARDING_VERSION re-shows it after major tour updates.
 *
 * The `scratchy.*` prefix is the app's stable storage namespace — it survives
 * the Scribble Party rename so existing devices keep their data.
 */
export const ONBOARDING_VERSION = 1;

const KEY = 'scratchy.onboarding.v1';

export function seenOnboardingVersion(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 0;
    const version = Number.parseInt(raw, 10);
    return Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(KEY, String(ONBOARDING_VERSION));
  } catch {
    // Storage unavailable (private mode); the tour shows again next launch.
  }
}
