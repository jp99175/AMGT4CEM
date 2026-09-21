// Pure puzzle logic: no DOM, no animation. The renderer must never mutate
// game state directly -- it only reacts to what this module reports.
import { Bottle } from "./bottle.js";
import { mulberry32 } from "./prng.js";

export function canPour(bottles, srcIdx, dstIdx) {
  if (srcIdx === dstIdx) return false;
  const src = bottles[srcIdx];
  const dst = bottles[dstIdx];
  if (!src || !dst) return false;
  if (src.isLocked || dst.isLocked) return false;
  if (src.isEmpty) return false;
  if (dst.isFull) return false;
  if (!dst.isEmpty && dst.topColor !== src.topColor) return false;
  return true;
}

// Mutates `bottles` in place. Returns the move record (for undo/history) or
// null if the move was illegal -- in which case nothing was changed.
export function pour(bottles, srcIdx, dstIdx) {
  if (!canPour(bottles, srcIdx, dstIdx)) return null;
  const src = bottles[srcIdx];
  const dst = bottles[dstIdx];
  const color = src.topColor;
  const runLength = src.topRunLength();
  const space = dst.capacity - dst.length;
  const amount = Math.min(runLength, space);
  for (let i = 0; i < amount; i++) {
    dst.colors.push(src.colors.pop());
  }
  return { from: srcIdx, to: dstIdx, color, amount };
}

export function undoPour(bottles, move) {
  if (!move) return;
  const dst = bottles[move.from];
  const src = bottles[move.to];
  for (let i = 0; i < move.amount; i++) {
    dst.colors.push(src.colors.pop());
  }
}

export function checkVictory(bottles) {
  return bottles.every((b) => b.isSolved);
}

// Builds a scrambled-but-always-solvable level: start from a fully solved
// arrangement, then repeatedly relocate a top run of color onto ANY bottle
// with room (ignoring color-matching). Each such relocation is, by
// construction, reversible by a *legal* forward pour, so playing the
// recorded moves back-to-front from this final state is always a valid
// solution.
function scramble({ colorCount, capacity, emptyBottles, shuffleMoves, seed }) {
  const rng = mulberry32(seed);
  const bottles = [];
  for (let c = 0; c < colorCount; c++) {
    bottles.push(new Bottle({ capacity, colors: Array(capacity).fill(c) }));
  }
  for (let e = 0; e < emptyBottles; e++) {
    bottles.push(new Bottle({ capacity, colors: [] }));
  }

  let done = 0;
  let attempts = 0;
  const maxAttempts = shuffleMoves * 30;

  while (done < shuffleMoves && attempts < maxAttempts) {
    attempts++;
    const srcIdx = Math.floor(rng() * bottles.length);
    const src = bottles[srcIdx];
    if (src.isEmpty) continue;

    const runLength = src.topRunLength();
    const k = 1 + Math.floor(rng() * runLength);

    const candidates = [];
    for (let d = 0; d < bottles.length; d++) {
      if (d === srcIdx) continue;
      const dst = bottles[d];
      if (dst.capacity - dst.length >= k) candidates.push(d);
    }
    if (candidates.length === 0) continue;

    const dstIdx = candidates[Math.floor(rng() * candidates.length)];
    const dst = bottles[dstIdx];
    for (let i = 0; i < k; i++) dst.colors.push(src.colors.pop());
    done++;
  }

  return bottles;
}

// Builds a scrambled-but-solvable level. The scramble step above is only
// *usually* solvable in one shot: when a destination bottle happens to
// already carry the same top color as the fragment being relocated onto it,
// the single-move "reverse pour" argument breaks down (a real pour later
// moves the whole merged run, not just the fragment), so a small fraction of
// rolls turn out to be traps. We verify with a full BFS and deterministically
// retry with a different seed until the result is conclusively solvable --
// this is the actual guarantee callers rely on, not the construction alone.
export function generateLevel({
  colorCount,
  capacity = 4,
  emptyBottles = 2,
  shuffleMoves = 60,
  seed = 1,
}) {
  const maxRetries = 24;
  let bottles = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const trySeed = seed + attempt * 104729;
    const candidate = scramble({ colorCount, capacity, emptyBottles, shuffleMoves, seed: trySeed });
    if (checkVictory(candidate)) continue; // degenerate roll, already solved

    const solvable = isSolvable(candidate, { maxStates: 150000 });
    if (solvable) {
      bottles = candidate;
      break;
    }
  }

  if (bottles) return bottles;

  // Extremely unlikely fallback: relax the puzzle (one more empty bottle,
  // gentler shuffle) so a solvable roll is essentially guaranteed.
  return generateLevel({
    colorCount,
    capacity,
    emptyBottles: emptyBottles + 1,
    shuffleMoves: Math.max(10, Math.floor(shuffleMoves * 0.7)),
    seed: seed + 1,
  });
}

function serialize(state) {
  return state.map((s) => s.join(",")).join("|");
}

function isStateSolved(state, capacities) {
  return state.every((s, idx) => s.length === 0 || (s.length === capacities[idx] && s.every((c) => c === s[0])));
}

function simulateMove(state, capacities, i, j) {
  const newState = state.map((s) => s.slice());
  const top = newState[i][newState[i].length - 1];
  let run = 0;
  for (let k = newState[i].length - 1; k >= 0 && newState[i][k] === top; k--) run++;
  const space = capacities[j] - newState[j].length;
  const amount = Math.min(run, space);
  for (let m = 0; m < amount; m++) newState[j].push(newState[i].pop());
  return newState;
}

// Greedy one-ply heuristic used as a fast fallback when the BFS hint search
// below is cut off by its exploration budget.
function greedyHint(bottles) {
  const n = bottles.length;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!canPour(bottles, i, j)) continue;
      const src = bottles[i];
      const dst = bottles[j];
      const run = src.topRunLength();
      const space = dst.capacity - dst.length;
      const amount = Math.min(run, space);
      let score = 0;
      const dstAfterLen = dst.length + amount;
      const srcAfterEmpty = src.length - amount === 0;
      const dstBecomesSolved =
        dstAfterLen === dst.capacity && (dst.isEmpty || dst.topColor === src.topColor) && run >= amount;
      if (dstBecomesSolved) score += 100;
      if (srcAfterEmpty) score += 40;
      score += amount;
      if (score > bestScore) {
        bestScore = score;
        best = { from: i, to: j };
      }
    }
  }
  return best;
}

// Shared breadth-first search core: explores reachable states (via legal
// pours only) up to `maxStates`, tracking each frontier state's very first
// move so callers can recover a solving move, not just a yes/no answer.
// Uses a head-index instead of Array#shift so it stays fast at the tens of
// thousands of states these puzzles can reach.
function bfsSolve(bottles, maxStates) {
  const capacities = bottles.map((b) => b.capacity);
  const startState = bottles.map((b) => b.colors.slice());
  if (isStateSolved(startState, capacities)) {
    return { solved: true, move: null, explored: 0, conclusive: true };
  }

  const visited = new Set([serialize(startState)]);
  const queue = [{ state: startState, firstMove: null }];
  let head = 0;
  let explored = 0;

  while (head < queue.length && explored < maxStates) {
    const { state, firstMove } = queue[head++];
    explored++;
    const n = state.length;
    for (let i = 0; i < n; i++) {
      if (state[i].length === 0 || bottles[i].isLocked) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || bottles[j].isLocked) continue;
        if (state[j].length >= capacities[j]) continue;
        const topI = state[i][state[i].length - 1];
        if (state[j].length > 0 && state[j][state[j].length - 1] !== topI) continue;

        const newState = simulateMove(state, capacities, i, j);
        const key = serialize(newState);
        if (visited.has(key)) continue;
        visited.add(key);

        const move = firstMove || { from: i, to: j };
        if (isStateSolved(newState, capacities)) {
          return { solved: true, move, explored, conclusive: true };
        }
        queue.push({ state: newState, firstMove: move });
      }
    }
  }

  // Exhausted the whole reachable space without finding a solution ->
  // conclusively unsolvable. Otherwise we just ran out of search budget.
  return { solved: false, move: null, explored, conclusive: head >= queue.length };
}

// Breadth-first search over a small exploration budget; falls back to a
// greedy heuristic move if the search space is too large to fully explore.
export function findHint(bottles, { maxStates = 20000 } = {}) {
  if (checkVictory(bottles)) return null;
  const result = bfsSolve(bottles, maxStates);
  if (result.solved) return result.move;
  return greedyHint(bottles);
}

// Conclusively decides whether `bottles` can be solved by legal pours,
// exploring the whole reachable state space (bounded by `maxStates` as a
// safety valve). Returns `null` if the budget was exhausted inconclusively.
export function isSolvable(bottles, { maxStates = 150000 } = {}) {
  const result = bfsSolve(bottles, maxStates);
  if (!result.conclusive) return null;
  return result.solved;
}
