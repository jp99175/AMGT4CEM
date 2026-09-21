import { generateLevel } from "./puzzle.js";

export const TOTAL_MVP_LEVELS = 20;

// Progressive difficulty curve for the 20-level MVP. `shuffleMoves` controls
// how many reverse-moves scramble the solved state (see generateLevel) --
// more moves means deeper entanglement between colors, not just more colors.
function difficultyFor(levelId) {
  if (levelId <= 2) return { colorCount: 3, emptyBottles: 2, shuffleMoves: 18 };
  if (levelId <= 5) return { colorCount: 4, emptyBottles: 2, shuffleMoves: 28 };
  if (levelId <= 8) return { colorCount: 5, emptyBottles: 2, shuffleMoves: 40 };
  if (levelId <= 11) return { colorCount: 6, emptyBottles: 2, shuffleMoves: 55 };
  if (levelId <= 14) return { colorCount: 7, emptyBottles: 1, shuffleMoves: 70 };
  if (levelId <= 17) return { colorCount: 8, emptyBottles: 1, shuffleMoves: 85 };
  return { colorCount: 9, emptyBottles: 1, shuffleMoves: 100 };
}

export function getLevelConfig(levelId) {
  const { colorCount, emptyBottles, shuffleMoves } = difficultyFor(levelId);
  return {
    id: levelId,
    capacity: 4,
    colorCount,
    emptyBottles,
    shuffleMoves,
    // Distinct, stable seed per level so a level always regenerates identically.
    seed: levelId * 7919 + 104729,
  };
}

// Generation is deterministic from the config, so this doubles as the
// "restart" source of truth (no need to persist a separate copy of the
// initial state). Harder configs pay a one-off solvability-verification
// cost inside generateLevel (up to ~1s) -- cache the verified result per
// level so restarting an already-visited level is instant, and always hand
// callers a fresh clone so mutating it (pouring) never corrupts the cache.
const cache = new Map();

export function buildLevel(levelId) {
  if (!cache.has(levelId)) {
    const config = getLevelConfig(levelId);
    cache.set(levelId, generateLevel(config));
  }
  return cache.get(levelId).map((b) => b.clone());
}
