/**
 * Device-global preferences (handedness, recording preset). Deliberately in
 * localStorage rather than IndexedDB: they must be readable synchronously at
 * first paint (no layout flash) and keep working when IndexedDB is
 * unavailable. Per-board prefs (tool, color, background…) autosave with the
 * lesson instead.
 */

export type Handedness = 'right' | 'left';

export interface AppSettings {
  handedness: Handedness;
  /** Recording preset id (see recording/presets.ts). */
  presetId: string;
  countdownSeconds: 0 | 3 | 5 | 10;
}

const KEY = 'scratchy.settings.v1';

const DEFAULTS: AppSettings = {
  handedness: 'right',
  presetId: 'compat',
  countdownSeconds: 3,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      handedness: parsed.handedness === 'left' ? 'left' : 'right',
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : DEFAULTS.presetId,
      countdownSeconds:
        parsed.countdownSeconds === 0 || parsed.countdownSeconds === 5 || parsed.countdownSeconds === 10
          ? parsed.countdownSeconds
          : 3,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a nicety — never let a full disk break the app.
  }
}
