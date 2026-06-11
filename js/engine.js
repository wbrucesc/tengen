// engine.js — pure Go (Baduk) rules engine. No DOM, no globals.
// Colors: 0 = empty, 1 = black, 2 = white.

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const other = (c) => (c === BLACK ? WHITE : BLACK);

// Default komi per board size (compensation for Black's first-move advantage).
export const KOMI = { 9: 5.5, 13: 6.5, 19: 7.5 };

export class Go {
  constructor(size = 9) {
    this.size = size;
    this.board = new Int8Array(size * size); // EMPTY/BLACK/WHITE
    this.turn = BLACK;
    this.komi = KOMI[size] ?? 6.5;
    this.captures = { [BLACK]: 0, [WHITE]: 0 }; // stones captured BY this color
    this.lastMove = null;       // {x,y} or {pass:true} or null
    this.passes = 0;            // consecutive passes
    this.history = [];          // stack of snapshots for undo
    this.positions = new Set(); // seen board hashes (positional superko)
    this.positions.add(this._hash());
    this.ended = false;
  }

  idx(x, y) { return y * this.size + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  get(x, y) { return this.board[this.idx(x, y)]; }

  _hash() {
    // Compact string hash of (board + turn). Fine for small boards.
    let s = this.turn === BLACK ? "b" : "w";
    return s + String.fromCharCode(...this.board.map((v) => v + 48));
  }

  neighbors(x, y) {
    const out = [];
    if (x > 0) out.push([x - 1, y]);
    if (x < this.size - 1) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]);
    if (y < this.size - 1) out.push([x, y + 1]);
    return out;
  }

  // Flood fill a connected group of one color. Returns {stones:[idx], libs:Set}.
  group(x, y) {
    const color = this.get(x, y);
    const stones = [];
    const libs = new Set();
    if (color === EMPTY) return { color, stones, libs };
    const seen = new Uint8Array(this.size * this.size);
    const stack = [[x, y]];
    seen[this.idx(x, y)] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      stones.push(this.idx(cx, cy));
      for (const [nx, ny] of this.neighbors(cx, cy)) {
        const ni = this.idx(nx, ny);
        const v = this.board[ni];
        if (v === EMPTY) libs.add(ni);
        else if (v === color && !seen[ni]) { seen[ni] = 1; stack.push([nx, ny]); }
      }
    }
    return { color, stones, libs };
  }

  liberties(x, y) { return this.group(x, y).libs.size; }

  // Is placing `color` at (x,y) legal? Returns {ok, reason, captures:[idx]}.
  tryMove(x, y, color = this.turn) {
    if (this.ended) return { ok: false, reason: "game over" };
    if (!this.inBounds(x, y)) return { ok: false, reason: "off board" };
    if (this.get(x, y) !== EMPTY) return { ok: false, reason: "occupied" };

    const i = this.idx(x, y);
    this.board[i] = color;

    // Find opponent groups left with no liberties -> captured.
    const opp = other(color);
    const captured = [];
    const checked = new Uint8Array(this.size * this.size);
    for (const [nx, ny] of this.neighbors(x, y)) {
      const ni = this.idx(nx, ny);
      if (this.board[ni] === opp && !checked[ni]) {
        const g = this.group(nx, ny);
        g.stones.forEach((s) => (checked[s] = 1));
        if (g.libs.size === 0) captured.push(...g.stones);
      }
    }

    // Tentatively remove captures to evaluate suicide + ko.
    for (const s of captured) this.board[s] = EMPTY;
    const myLibs = this.group(x, y).libs.size;

    if (captured.length === 0 && myLibs === 0) {
      this.board[i] = EMPTY; // undo: suicide is illegal
      return { ok: false, reason: "suicide" };
    }

    // Positional superko: this resulting position (with opponent to move) must be new.
    const prevTurn = this.turn;
    this.turn = opp;
    const h = this._hash();
    const repeat = this.positions.has(h);
    this.turn = prevTurn;

    // Roll back the tentative application; caller commits via play().
    this.board[i] = EMPTY;
    for (const s of captured) this.board[s] = opp;

    if (repeat) return { ok: false, reason: "ko" };
    return { ok: true, captures: captured, color, x, y, hash: h };
  }

  snapshot() {
    return {
      board: this.board.slice(),
      turn: this.turn,
      captures: { ...this.captures },
      lastMove: this.lastMove,
      passes: this.passes,
      ended: this.ended,
    };
  }

  play(x, y, color = this.turn) {
    const res = this.tryMove(x, y, color);
    if (!res.ok) return res;
    this.history.push(this.snapshot());
    this.board[this.idx(x, y)] = color;
    for (const s of res.captures) this.board[s] = EMPTY;
    this.captures[color] += res.captures.length;
    this.lastMove = { x, y };
    this.passes = 0;
    this.turn = other(color);
    this.positions.add(res.hash);
    return res;
  }

  pass(color = this.turn) {
    this.history.push(this.snapshot());
    this.lastMove = { pass: true };
    this.passes += 1;
    this.turn = other(color);
    if (this.passes >= 2) this.ended = true;
    return { ok: true, pass: true, ended: this.ended };
  }

  undo() {
    const s = this.history.pop();
    if (!s) return false;
    this.board = s.board;
    this.turn = s.turn;
    this.captures = s.captures;
    this.lastMove = s.lastMove;
    this.passes = s.passes;
    this.ended = s.ended;
    // Rebuild seen-positions set from current board only (approximate: clears
    // superko history but prevents false "ko" after undo). Good enough for play.
    this.positions = new Set([this._hash()]);
    return true;
  }

  // --- Atari / danger detection -------------------------------------------
  // Returns array of {stones:[idx], color, libs} for every group in atari.
  atariGroups() {
    const seen = new Uint8Array(this.size * this.size);
    const out = [];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const i = this.idx(x, y);
        if (this.board[i] === EMPTY || seen[i]) continue;
        const g = this.group(x, y);
        g.stones.forEach((s) => (seen[s] = 1));
        if (g.libs.size === 1) out.push({ stones: g.stones, color: g.color, libs: 1 });
      }
    }
    return out;
  }

  // --- Scoring -------------------------------------------------------------
  // Area scoring (Chinese): stones on board + surrounded empty territory.
  // `dead` is a Set of board indices marked dead (removed before counting).
  score(dead = new Set()) {
    const b = this.board.slice();
    const capturesAdj = { [BLACK]: 0, [WHITE]: 0 };
    for (const i of dead) {
      if (b[i] !== EMPTY) { capturesAdj[other(b[i])] += 1; b[i] = EMPTY; }
    }
    let blackArea = 0, whiteArea = 0, neutral = 0;
    const seen = new Uint8Array(this.size * this.size);
    for (let i = 0; i < b.length; i++) {
      if (b[i] === BLACK) blackArea++;
      else if (b[i] === WHITE) whiteArea++;
    }
    // Flood empty regions; assign to a color if bordered by exactly one color.
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== EMPTY || seen[i]) continue;
      const region = [];
      const borders = new Set();
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        region.push(c);
        const cx = c % this.size, cy = (c / this.size) | 0;
        for (const [nx, ny] of this.neighbors(cx, cy)) {
          const ni = this.idx(nx, ny);
          if (b[ni] === EMPTY) { if (!seen[ni]) { seen[ni] = 1; stack.push(ni); } }
          else borders.add(b[ni]);
        }
      }
      if (borders.size === 1) {
        if (borders.has(BLACK)) blackArea += region.length;
        else whiteArea += region.length;
      } else neutral += region.length;
    }
    const blackScore = blackArea;
    const whiteScore = whiteArea + this.komi;
    return {
      blackArea, whiteArea, neutral,
      komi: this.komi,
      blackScore, whiteScore,
      margin: blackScore - whiteScore,
      winner: blackScore > whiteScore ? BLACK : WHITE,
    };
  }

  // Per-point ownership map for the end-of-game territory fill animation.
  // Returns Int8Array: BLACK/WHITE for owned points, EMPTY for neutral.
  ownership(dead = new Set()) {
    const b = this.board.slice();
    for (const i of dead) b[i] = EMPTY;
    const owner = new Int8Array(this.size * this.size);
    for (let i = 0; i < b.length; i++) owner[i] = b[i];
    const seen = new Uint8Array(this.size * this.size);
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== EMPTY || seen[i]) continue;
      const region = [];
      const borders = new Set();
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        region.push(c);
        const cx = c % this.size, cy = (c / this.size) | 0;
        for (const [nx, ny] of this.neighbors(cx, cy)) {
          const ni = this.idx(nx, ny);
          if (b[ni] === EMPTY) { if (!seen[ni]) { seen[ni] = 1; stack.push(ni); } }
          else borders.add(b[ni]);
        }
      }
      if (borders.size === 1) {
        const c = borders.has(BLACK) ? BLACK : WHITE;
        for (const r of region) owner[r] = c;
      }
    }
    return owner;
  }

  // --- Influence map (live "who's ahead" heatmap for beginners) ------------
  // Bouzy-style dilation/erosion. Returns Float32Array; sign = color leaning,
  // magnitude = confidence. Great for visualising territory mid-game.
  influence(nd = 4, ne = 13) {
    const n = this.size;
    let f = new Float32Array(n * n);
    for (let i = 0; i < f.length; i++) {
      f[i] = this.board[i] === BLACK ? 1 : this.board[i] === WHITE ? -1 : 0;
    }
    const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const at = (x, y) => f[y * n + x];
    // Dilation: grow influence where no opposing sign is adjacent.
    for (let pass = 0; pass < nd; pass++) {
      const g = f.slice();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = at(x, y);
        const s0 = sign(v);
        let pos = 0, neg = 0;
        for (const [nx, ny] of this.neighbors(x, y)) {
          const s = sign(at(nx, ny));
          if (s > 0) pos++; else if (s < 0) neg++;
        }
        if (s0 >= 0 && neg === 0 && pos > 0) g[y * n + x] = v + pos;
        else if (s0 <= 0 && pos === 0 && neg > 0) g[y * n + x] = v - neg;
        else if (s0 > 0 && neg === 0) g[y * n + x] = v + pos;
        else if (s0 < 0 && pos === 0) g[y * n + x] = v - neg;
      }
      f = g;
    }
    // Erosion: shrink influence near opposing/empty borders.
    for (let pass = 0; pass < ne; pass++) {
      const g = f.slice();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = at(x, y);
        if (v === 0) continue;
        const s0 = sign(v);
        let opp = 0;
        for (const [nx, ny] of this.neighbors(x, y)) {
          const s = sign(at(nx, ny));
          if (s !== s0) opp++;
        }
        const nv = v - s0 * opp;
        g[y * n + x] = sign(nv) === s0 ? nv : 0;
      }
      f = g;
    }
    return f;
  }
}
