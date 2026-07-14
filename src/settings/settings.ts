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
}

const KEY = 'scratchy.settings.v1';

const DEFAULTS: AppSettings = {
  handedness: 'right',
  presetId: 'compat',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      handedness: parsed.handedness === 'left' ? 'left' : 'right',
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : DEFAULTS.presetId,
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
