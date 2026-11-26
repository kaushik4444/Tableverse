'use strict';
/**
 * Sudoku puzzles, made here (never copied from a publisher): a full grid is filled in at random, then clues are removed one at a
 * time while the puzzle keeps exactly one solution. Pure functions; `rng` is the game's seeded random source.
 * Grids are flat arrays of 81 numbers, row by row; 0 is an empty square.
 */

/** Clues left on the board for each difficulty. Fewer clues = harder. */
const CLUES = { easy: 40, medium: 32, hard: 26 };

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The numbers that may still go in square `idx` without repeating in its row, column or box. */
function candidates(grid, idx) {
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  const used = new Set();
  for (let k = 0; k < 9; k++) {
    used.add(grid[r * 9 + k]);
    used.add(grid[k * 9 + c]);
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) used.add(grid[(br + dr) * 9 + bc + dc]);
  const out = [];
  for (let v = 1; v <= 9; v++) if (!used.has(v)) out.push(v);
  return out;
}

/** How many solutions the grid has, counted up to `limit` (so a unique puzzle returns 1). Tries the emptiest square first. */
function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  let count = 0;
  const go = () => {
    if (count >= limit) return;
    let best = -1;
    let bestC = null;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const c = candidates(g, i);
      if (!bestC || c.length < bestC.length) {
        best = i;
        bestC = c;
        if (c.length <= 1) break;
      }
    }
    if (best < 0) { count++; return; }
    for (const v of bestC) {
      g[best] = v;
      go();
      g[best] = 0;
      if (count >= limit) return;
    }
  };
  go();
  return count;
}

/** A complete valid grid, filled in at random. */
function fullGrid(rng) {
  const g = new Array(81).fill(0);
  const fill = () => {
    const i = g.indexOf(0);
    if (i < 0) return true;
    for (const v of shuffle(candidates(g, i), rng)) {
      g[i] = v;
      if (fill()) return true;
    }
    g[i] = 0;
    return false;
  };
  fill();
  return g;
}

/** A puzzle for the difficulty, with its solution. Removing clues stops early if the puzzle would lose its single solution. */
function makePuzzle(rng, difficulty = 'medium') {
  const target = CLUES[difficulty] || CLUES.medium;
  const solution = fullGrid(rng);
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle([...Array(81).keys()], rng)) {
    if (clues <= target) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle, 2) === 1) clues--;
    else puzzle[i] = keep;
  }
  return { puzzle, solution, clues };
}

module.exports = { CLUES, candidates, countSolutions, fullGrid, makePuzzle };
