import { generateLevel } from "./puzzle.js";

// Number of "milestone" levels the level-select grid always shows, even for
// a brand new player. Progression itself is uncapped -- see difficultyFor.
export const CURATED_LEVELS = 20;

// Progressive difficulty curve. `shuffleMoves` controls how many
// reverse-moves scramble the solved state (see generateLevel) -- more moves
// means deeper entanglement between colors, not just more colors. Past the
// curated 20, difficulty keeps climbing slowly and indefinitely so the game
// never plateaus, capped at the size of the color palette (14).
function difficultyFor(levelId) {
  if (levelId <= 2) return { colorCount: 3, emptyBottles: 2, shuffleMoves: 18 };
  if (levelId <= 5) return { colorCount: 4, emptyBottles: 2, shuffleMoves: 28 };
  if (levelId <= 8) return { colorCount: 5, emptyBottles: 2, shuffleMoves: 40 };
  if (levelId <= 11) return { colorCount: 6, emptyBottles: 2, shuffleMoves: 55 };
  if (levelId <= 14) return { colorCount: 7, emptyBottles: 1, shuffleMoves: 70 };
  if (levelId <= 17) return { colorCount: 8, emptyBottles: 1, shuffleMoves: 85 };
  if (levelId <= CURATED_LEVELS) return { colorCount: 9, emptyBottles: 1, shuffleMoves: 100 };

  const beyond = levelId - CURATED_LEVELS;
  return {
    colorCount: Math.min(14, 9 + Math.floor(beyond / 6)),
    emptyBottles: 1,
    shuffleMoves: Math.min(160, 100 + beyond * 3),
  };
}

export function getLevelConfig(levelId) {
  const { colorCount, emptyBottles, shuffleMoves } = difficultyFor(levelId);
  return { id: levelId, capacity: 4, colorCount, emptyBottles, shuffleMoves };
}

// A fresh, unpredictable seed for a new puzzle instance. Not used for
// anything security-sensitive -- just needs to vary between playthroughs.
export function randomSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 31);
}

// Same (levelId, seed) pair always reproduces the identical layout (needed
// for Restart and for surviving a page reload mid-level); the *caller*
// decides when to draw a fresh `randomSeed()` (only when entering a level
// instance for the first time), which is what makes every playthrough of
// "level 7" a different puzzle at the same difficulty instead of the same
// fixed layout every time.
//
// Harder configs pay a one-off solvability-verification cost inside
// generateLevel (up to ~1s) -- cache per (levelId, seed) so restarting an
// already-built instance is instant, and always hand callers a fresh clone
// so mutating it (pouring) never corrupts the cache.
const cache = new Map();

export function buildLevel(levelId, seed) {
  const key = `${levelId}:${seed}`;
  if (!cache.has(key)) {
    const config = getLevelConfig(levelId);
    cache.set(key, generateLevel({ ...config, seed }));
  }
  return cache.get(key).map((b) => b.clone());
}
