const KEY = "chromix.save.v1";

function defaultSave() {
  return {
    currentLevel: 1,
    completedLevels: [],
    coins: 30,
    settings: { music: true, sfx: true },
    unlockedThemes: ["default"],
    tutorialSeen: false,
  };
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    return { ...defaultSave(), ...parsed, settings: { ...defaultSave().settings, ...(parsed.settings || {}) } };
  } catch {
    return defaultSave();
  }
}

export function saveProgress(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode, quota exceeded) -- progress just won't persist.
  }
}
