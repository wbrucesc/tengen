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

// Deterministic "best move" with a beginner-friendly explanation, for the
// Hint button. Walks a priority ladder and names the specific idea behind the
// move so the reason reads as intentional, never a vague fallback.
function countStones(go) { let n = 0; for (let i = 0; i < go.board.length; i++) if (go.board[i] !== EMPTY) n++; return n; }
function friendlyGroupCount(go, x, y, color) {
  const ids = new Set();
  for (const [nx, ny] of go.neighbors(x, y))
    if (go.get(nx, ny) === color) { const g = go.group(nx, ny); ids.add(Math.min(...g.stones)); }
  return ids.size;
}
function enemyNeighbors(go, x, y, color) {
  let n = 0; for (const [nx, ny] of go.neighbors(x, y)) if (go.get(nx, ny) === other(color)) n++; return n;
}
function emptyNeighbors(go, x, y) {
  let n = 0; for (const [nx, ny] of go.neighbors(x, y)) if (go.get(nx, ny) === EMPTY) n++; return n;
}
function openingPoints(size) {
  const e = size <= 9 ? 2 : 3;            // 3-3 / star offset from the edge
  const lo = e, hi = size - 1 - e, mid = (size - 1) / 2;
  const corners = [[lo, lo], [hi, lo], [lo, hi], [hi, hi]];
  const sides = size >= 13 ? [[mid, lo], [mid, hi], [lo, mid], [hi, mid]] : [];
  return { corners, sides };
}

export function suggest(go, color) {
  const moves = legalMoves(go, color);
  if (!moves.length)
    return { pass: true, reason: "There are no useful moves left here — passing is the right call." };
  const safe = (m) => libsAfter(go, m.x, m.y, color) >= 2;

  // 1) Capture something right now.
  const caps = moves.filter((m) => m.captures > 0).sort((a, b) => b.captures - a.captures);
  if (caps.length) {
    const n = caps[0].captures;
    return { ...caps[0], reason: `This captures ${n > 1 ? n + " stones" : "a stone"} immediately — they had no liberties left.` };
  }

  // 2) Rescue your own group that's in atari.
  const myAtari = go.atariGroups().filter((g) => g.color === color);
  if (myAtari.length) {
    const esc = moves.map((m) => ({ ...m, libs: libsAfter(go, m.x, m.y, color) }))
      .filter((m) => m.libs >= 2 && touchesGroup(go, m, myAtari))
      .sort((a, b) => b.libs - a.libs);
    if (esc.length)
      return { ...esc[0], reason: "This rescues your group that was in atari — it had just one liberty, and this gives it room to breathe again." };
  }

  // 3) Put an opponent group in atari.
  const atk = moves.filter((m) => safe(m) && givesAtari(go, m.x, m.y, color));
  if (atk.length)
    return { ...atk[0], reason: "This puts one of your opponent's groups in atari — down to its last liberty, so you threaten to capture it next turn." };

  // 4) Connect your own groups into one.
  const conn = moves.filter((m) => safe(m) && friendlyGroupCount(go, m.x, m.y, color) >= 2)
    .sort((a, b) => friendlyGroupCount(go, b.x, b.y, color) - friendlyGroupCount(go, a.x, a.y, color));
  if (conn.length)
    return { ...conn[0], reason: "This connects your stones into one solid group — joined stones share their liberties and can't be cut apart." };

  // 5) Opening: claim an empty corner (then a side) while the board is open.
  if (countStones(go) < go.size) {
    const op = openingPoints(go.size);
    for (const [px, py] of [...op.corners, ...op.sides]) {
      if (go.get(px, py) !== EMPTY) continue;
      if (!go.tryMove(px, py, color).ok) continue;
      const isCorner = op.corners.some(([cx, cy]) => cx === px && cy === py);
      return { x: px, y: py, reason: isCorner
        ? "Corners are the easiest place to make secure territory, so grabbing one is among the best opening moves."
        : "This takes a big point on the side, staking out a wide area while the board is still open." };
    }
  }

  // 6) Press against the opponent to block their expansion (stay connected).
  const press = moves.filter((m) => safe(m) && enemyNeighbors(go, m.x, m.y, color) >= 1 && friendlyGroupCount(go, m.x, m.y, color) >= 1)
    .sort((a, b) => enemyNeighbors(go, b.x, b.y, color) - enemyNeighbors(go, a.x, a.y, color));
  if (press.length)
    return { ...press[0], reason: "This blocks your opponent from pushing further into your area, while staying linked to your own stones." };

  // 7) Extend a group into open space.
  const ext = moves.filter((m) => safe(m) && friendlyGroupCount(go, m.x, m.y, color) >= 1 && emptyNeighbors(go, m.x, m.y) >= 2)
    .sort((a, b) => emptyNeighbors(go, b.x, b.y) - emptyNeighbors(go, a.x, a.y));
  if (ext.length)
    return { ...ext[0], reason: "This extends your group toward open space, giving it more liberties and a stronger shape." };

  // 8) Last resort: a calm point near the centre to build a framework.
  const c = (go.size - 1) / 2;
  const open = moves.filter(safe).map((m) => ({ ...m, d: Math.abs(m.x - c) + Math.abs(m.y - c) })).sort((a, b) => a.d - b.d);
  if (open.length)
    return { ...open[0], reason: "This claims an open area to begin sketching out a framework of your own." };
  return { pass: true, reason: "Nothing stands out here — passing is reasonable." };
}
