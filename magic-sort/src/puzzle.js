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

// True if at least one legal pour exists anywhere on the board -- used to
// detect a deadlock (not won, but nothing left to do except undo/restart/add
// a bottle).
export function hasAnyMove(bottles) {
  for (let i = 0; i < bottles.length; i++) {
    for (let j = 0; j < bottles.length; j++) {
      if (canPour(bottles, i, j)) return true;
    }
  }
  return false;
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
  const maxAttempts = shuffleMoves * 40;

  while (done < shuffleMoves && attempts < maxAttempts) {
    attempts++;
    const srcIdx = Math.floor(rng() * bottles.length);
    const src = bottles[srcIdx];
    if (src.isEmpty) continue;

    const runLength = src.topRunLength();
    const color = src.topColor;
    // The reverse of this exact move (an undo-pour from the destination
    // back to `src`) must land legally: `src`'s new top has to still be
    // `color`, or `src` must end up empty. That's only true if we either
    // (a) leave at least one unit of `color` behind on `src`, or
    // (b) drain the whole bottle, which only leaves it empty when the top
    // run IS the entire bottle (nothing of a different color sits below).
    const wholeBottleIsOneRun = runLength === src.length;
    const maxK = wholeBottleIsOneRun ? runLength : runLength - 1;
    if (maxK < 1) continue;
    const k = 1 + Math.floor(rng() * maxK);

    const candidates = [];
    for (let d = 0; d < bottles.length; d++) {
      if (d === srcIdx) continue;
      const dst = bottles[d];
      if (dst.capacity - dst.length < k) continue;
      // Never stack onto a matching top color: that would merge into a run
      // longer than `k`, and undoing it later would over-drain `dst`.
      if (!dst.isEmpty && dst.topColor === color) continue;
      candidates.push(d);
    }
    if (candidates.length === 0) continue;

    const dstIdx = candidates[Math.floor(rng() * candidates.length)];
    const dst = bottles[dstIdx];
    for (let i = 0; i < k; i++) dst.colors.push(src.colors.pop());
    done++;
  }

  return bottles;
}

// Builds a scrambled level that is *solvable by construction*: every
// scramble step above is chosen so its exact reverse (an undo-pour from the
// destination back to the source) is itself a single legal pour at the
// moment it would be applied. Playing the whole scramble sequence backwards
// -- last move first -- is therefore always a valid solution, by induction:
// undoing move N restores the state right after move N-1, whose own reverse
// is legal for the same reason, and so on down to the solved state. No
// search-based verification is needed (and, empirically, a full BFS over
// puzzles with 8+ colors is far too slow to run live anyway).
export function generateLevel({ colorCount, capacity = 4, emptyBottles = 2, shuffleMoves = 60, seed = 1 }) {
  const bottles = scramble({ colorCount, capacity, emptyBottles, shuffleMoves, seed });
  if (checkVictory(bottles)) {
    // Degenerate roll (the constrained scramble ran out of legal moves
    // almost immediately) -- retry with a different seed.
    return generateLevel({
      colorCount,
      capacity,
      emptyBottles,
      shuffleMoves: shuffleMoves + 10,
      seed: seed + 104729,
    });
  }
  return bottles;
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
