// ai.js — a gentle heuristic opponent. Not strong; tuned to be a friendly,
// beatable sparring partner for beginners on small boards.
import { EMPTY, BLACK, WHITE, other } from "./engine.js";

// Strength presets bias randomness and how greedily the bot reacts.
export const LEVELS = {
  gentle: { noise: 0.55, look: false }, // very forgiving
  easy:   { noise: 0.30, look: false },
  steady: { noise: 0.12, look: true },  // reads simple captures
};

function isEye(go, x, y, color) {
  // Empty point fully surrounded (orthogonally) by `color`; most diagonals too.
  if (go.get(x, y) !== EMPTY) return false;
  for (const [nx, ny] of go.neighbors(x, y)) if (go.get(nx, ny) !== color) return false;
  let diagBad = 0, diagTotal = 0;
  for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const ax = x + dx, ay = y + dy;
    if (!go.inBounds(ax, ay)) continue; // edge diagonals are friendly
    diagTotal++;
    if (go.get(ax, ay) === other(color)) diagBad++;
  }
  const onEdge = x === 0 || y === 0 || x === go.size - 1 || y === go.size - 1;
  return onEdge ? diagBad === 0 : diagBad <= 1;
}

function legalMoves(go, color) {
  const moves = [];
  for (let y = 0; y < go.size; y++) for (let x = 0; x < go.size; x++) {
    if (go.get(x, y) !== EMPTY) continue;
    if (isEye(go, x, y, color)) continue; // never fill our own eyes
    const t = go.tryMove(x, y, color);
    if (t.ok) moves.push({ x, y, captures: t.captures.length });
  }
  return moves;
}

// Liberties a group would have after a hypothetical placement.
function libsAfter(go, x, y, color) {
  const t = go.tryMove(x, y, color);
  if (!t.ok) return -1;
  go.board[go.idx(x, y)] = color;
  for (const s of t.captures) go.board[s] = EMPTY;
  const libs = go.group(x, y).libs.size;
  // restore
  go.board[go.idx(x, y)] = EMPTY;
  for (const s of t.captures) go.board[s] = other(color);
  return libs;
}

export function chooseMove(go, color, levelName = "easy") {
  const level = LEVELS[levelName] ?? LEVELS.easy;
  const moves = legalMoves(go, color);
  if (moves.length === 0) return { pass: true };

  // 1) Capture anything we can (highest priority, always taken).
  const caps = moves.filter((m) => m.captures > 0);
  if (caps.length) return pick(caps);

  // 2) Save our own groups that are in atari (extend to >1 liberty).
  if (level.look) {
    const myAtari = go.atariGroups().filter((g) => g.color === color);
    if (myAtari.length) {
      const escapes = moves
        .map((m) => ({ ...m, libs: libsAfter(go, m.x, m.y, color) }))
        .filter((m) => m.libs >= 2)
        .sort((a, b) => b.libs - a.libs);
      // only bother if this move actually touches an endangered group
      const near = escapes.filter((m) => touchesGroup(go, m, myAtari));
      if (near.length && Math.random() > level.noise) return pick(near.slice(0, 3));
    }
    // 3) Atari an opponent group (reduce it to 1 liberty).
    if (Math.random() > level.noise) {
      const aggressive = moves.filter((m) => givesAtari(go, m.x, m.y, color));
      if (aggressive.length) return pick(aggressive);
    }
  }

  // 4) Otherwise: avoid self-atari, prefer playing near existing stones and
  //    toward the centre on small boards. Add noise so it feels human.
  const c = (go.size - 1) / 2;
  const scored = moves
    .filter((m) => libsAfter(go, m.x, m.y, color) >= 2 || Math.random() < 0.15)
    .map((m) => {
      const centre = -(Math.abs(m.x - c) + Math.abs(m.y - c));
      const contact = neighborStones(go, m.x, m.y);
      const jitter = Math.random() * 6 * level.noise;
      return { ...m, s: centre * 0.4 + contact * 1.5 + jitter };
    })
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { pass: true };
  return scored[0];
}

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function neighborStones(go, x, y) {
  let n = 0;
  for (const [nx, ny] of go.neighbors(x, y)) if (go.get(nx, ny) !== EMPTY) n++;
  return n;
}

function touchesGroup(go, move, groups) {
  const set = new Set();
  for (const g of groups) g.stones.forEach((s) => set.add(s));
  for (const [nx, ny] of go.neighbors(move.x, move.y)) if (set.has(go.idx(nx, ny))) return true;
  return false;
}

function givesAtari(go, x, y, color) {
  const t = go.tryMove(x, y, color);
  if (!t.ok) return false;
  go.board[go.idx(x, y)] = color;
  let atari = false;
  for (const [nx, ny] of go.neighbors(x, y)) {
    if (go.get(nx, ny) === other(color) && go.group(nx, ny).libs.size === 1) { atari = true; break; }
  }
  go.board[go.idx(x, y)] = EMPTY;
  return atari;
}
