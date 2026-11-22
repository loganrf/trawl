// Save and load the survey in localStorage.

const KEY = 'trawl-save-v1';

export interface SaveData {
  version: 1;
  seed: number;
  score: number;
  discovered: { id: string; time: number; place: string }[];
  falseContacts: number;
  lineLength: number;
  boat: { x: number; z: number; heading: number };
  cable: number;
  coverage?: string;
  playTime: number;
}

export function loadSave(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const d = JSON.parse(s) as SaveData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage full or unavailable: drop the coverage image and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...d, coverage: undefined }));
    } catch {
      /* give up silently */
    }
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
