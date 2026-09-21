const KEY = "chromix.save.v1";

function defaultSave() {
  return {
    currentLevel: 1,
    completedLevels: [],
    coins: 30,
    settings: { music: true, sfx: true },
    unlockedThemes: ["default"],
    tutorialSeen: false,
    // The puzzle instance currently in play: same (id, seed) pair across a
    // page reload or Restart, but a fresh random seed each time a *new*
    // level is entered -- see src/levels.js.
    activeLevelId: null,
    activeSeed: null,
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
