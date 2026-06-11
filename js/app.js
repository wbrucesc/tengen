// app.js — UI, rendering, interaction, sound. Wires the engine to the screen.
import { Go, EMPTY, BLACK, WHITE, other, KOMI } from "./engine.js";
import { chooseMove } from "./ai.js";

const $ = (sel) => document.querySelector(sel);
const canvas = $("#board");
const ctx = canvas.getContext("2d");

// ---- Palette (low-tech dither + EP-40 riddim) ------------------------------
const C = {
  paper: "#efe7d3",
  board: "#e4d2a8",
  line: "#3a3226",
  ink: "#211e18",     // black stones
  cream: "#f4eeda",   // white stones
  orange: "#df5b25",  // combustion accent
  green: "#1f4a3a",   // deep green accent
  shadow: "rgba(33,30,24,.28)",
};

// ---- Game state ------------------------------------------------------------
const state = {
  go: null,
  mode: "computer",      // "computer" | "friend"
  human: BLACK,          // which color the human plays in computer mode
  level: "easy",
  showTerritory: false,
  showAtari: true,
  confirmMoves: true,
  candidate: null,       // {x,y} pending confirmation
  hint: null,            // {x,y} suggested
  scoring: false,        // in end-of-game dead-stone marking
  dead: new Set(),
  reveal: 0,             // 0..1 territory-fill animation progress
  anims: [],             // capture pops etc.
  busy: false,           // AI thinking / animating lock
};

// ---- Audio + haptics -------------------------------------------------------
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (actx && actx.state === "suspended") actx.resume();
  return actx;
}
function clack(kind = "place") {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  if (kind === "capture") {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.24);
  } else {
    // short noisy "tock"
    const buf = a.createBuffer(1, 1024, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 8);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.value = 0.5;
    const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1600; f.Q.value = 0.7;
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  }
}
function buzz(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

// ---- Geometry --------------------------------------------------------------
let geom = { cell: 0, pad: 0, dpr: 1, css: 0 };
function layout() {
  const size = state.go.size;
  const wrap = $("#board-wrap");
  const css = Math.min(wrap.clientWidth, wrap.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = css + "px";
  canvas.style.height = css + "px";
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  const cell = css / (size + 1);
  geom = { cell, pad: cell, dpr, css };
}
const toPx = (i) => geom.pad + i * geom.cell;
function nearest(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  const gx = Math.round((x - geom.pad) / geom.cell);
  const gy = Math.round((y - geom.pad) / geom.cell);
  if (gx < 0 || gy < 0 || gx >= state.go.size || gy >= state.go.size) return null;
  const dx = x - toPx(gx), dy = y - toPx(gy);
  if (Math.hypot(dx, dy) > geom.cell * 0.62) return null;
  return { x: gx, y: gy };
}

// ---- Drawing ---------------------------------------------------------------
function starPoints(size) {
  if (size === 9) return [[2,2],[6,2],[2,6],[6,6],[4,4]];
  if (size === 13) return [[3,3],[9,3],[3,9],[9,9],[6,6]];
  if (size === 19) return [[3,3],[9,3],[15,3],[3,9],[9,9],[15,9],[3,15],[9,15],[15,15]];
  return [];
}

function draw(now = 0) {
  const go = state.go, size = go.size, cell = geom.cell, dpr = geom.dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, geom.css, geom.css);

  // Board field
  ctx.fillStyle = C.board;
  roundRect(ctx, 0, 0, geom.css, geom.css, cell * 0.35); ctx.fill();

  // Live territory / influence heatmap (beginner aid)
  if (state.showTerritory && !state.scoring) {
    const inf = go.influence();
    for (let i = 0; i < inf.length; i++) {
      const v = inf[i]; if (v === 0) continue;
      const x = i % size, y = (i / size) | 0;
      const a = Math.min(0.34, 0.12 + Math.abs(v) * 0.05);
      ctx.fillStyle = v > 0 ? `rgba(33,30,24,${a})` : `rgba(244,238,218,${a + 0.1})`;
      ctx.fillRect(toPx(x) - cell / 2, toPx(y) - cell / 2, cell, cell);
    }
  }

  // Grid
  ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, cell * 0.035); ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    ctx.moveTo(toPx(0), toPx(i)); ctx.lineTo(toPx(size - 1), toPx(i));
    ctx.moveTo(toPx(i), toPx(0)); ctx.lineTo(toPx(i), toPx(size - 1));
  }
  ctx.stroke();
  // Star points
  ctx.fillStyle = C.line;
  for (const [sx, sy] of starPoints(size)) {
    ctx.beginPath(); ctx.arc(toPx(sx), toPx(sy), cell * 0.08, 0, 7); ctx.fill();
  }

  // End-of-game ownership fill
  if (state.scoring && state.reveal > 0) {
    const owner = go.ownership(state.dead);
    for (let i = 0; i < owner.length; i++) {
      if (go.board[i] !== EMPTY && !state.dead.has(i)) continue;
      const o = owner[i]; if (o === EMPTY) continue;
      const x = i % size, y = (i / size) | 0;
      const a = 0.4 * state.reveal;
      ctx.fillStyle = o === BLACK ? `rgba(33,30,24,${a})` : `rgba(244,238,218,${a + 0.12})`;
      ctx.fillRect(toPx(x) - cell / 2, toPx(y) - cell / 2, cell, cell);
    }
  }

  // Stones
  const r = cell * 0.46;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = go.get(x, y); if (v === EMPTY) continue;
    const dead = state.dead.has(go.idx(x, y));
    drawStone(toPx(x), toPx(y), r, v, dead);
  }

  // Atari warnings
  if (state.showAtari && !state.scoring) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    for (const g of go.atariGroups()) {
      for (const s of g.stones) {
        const x = s % size, y = (s / size) | 0;
        ctx.strokeStyle = `rgba(223,91,37,${0.45 + 0.45 * pulse})`;
        ctx.lineWidth = cell * 0.07;
        ctx.beginPath(); ctx.arc(toPx(x), toPx(y), r + cell * 0.12, 0, 7); ctx.stroke();
      }
    }
  }

  // Last move marker
  const lm = go.lastMove;
  if (lm && !lm.pass && !state.scoring) {
    ctx.fillStyle = go.get(lm.x, lm.y) === BLACK ? C.cream : C.ink;
    ctx.beginPath(); ctx.arc(toPx(lm.x), toPx(lm.y), cell * 0.12, 0, 7); ctx.fill();
  }

  // Hint marker
  if (state.hint) {
    ctx.strokeStyle = C.green; ctx.lineWidth = cell * 0.08;
    ctx.beginPath(); ctx.arc(toPx(state.hint.x), toPx(state.hint.y), r, 0, 7); ctx.stroke();
  }

  // Candidate ghost stone
  if (state.candidate && !state.scoring) {
    const { x, y } = state.candidate;
    ctx.globalAlpha = 0.55;
    drawStone(toPx(x), toPx(y), r, go.turn, false);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.orange; ctx.lineWidth = cell * 0.06;
    ctx.beginPath(); ctx.arc(toPx(x), toPx(y), r + cell * 0.1, 0, 7); ctx.stroke();
  }

  // Capture pops
  for (const an of state.anims) {
    const p = (now - an.t) / 260; if (p >= 1) continue;
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = C.orange; ctx.lineWidth = cell * 0.06;
    ctx.beginPath(); ctx.arc(toPx(an.x), toPx(an.y), r * (1 + p), 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  state.anims = state.anims.filter((a) => now - a.t < 260);

  ctx.restore();
}

function drawStone(cx, cy, r, color, dead) {
  ctx.save();
  if (dead) ctx.globalAlpha = 0.32;
  // drop shadow for the "analog dimension"
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.arc(cx + r * 0.12, cy + r * 0.16, r, 0, 7); ctx.fill();
  // body
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  if (color === BLACK) { g.addColorStop(0, "#4a4438"); g.addColorStop(1, C.ink); }
  else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#ddd3ba"); }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = color === BLACK ? "rgba(0,0,0,.4)" : "rgba(120,108,80,.5)";
  ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
}

// ---- Render loop -----------------------------------------------------------
let raf = 0;
function loop(t) {
  if (state.scoring && state.reveal < 1) state.reveal = Math.min(1, state.reveal + 0.04);
  draw(t);
  raf = requestAnimationFrame(loop);
}

// ---- Status / HUD ----------------------------------------------------------
function updateHud() {
  const go = state.go;
  const turnEl = $("#turn");
  if (go.ended || state.scoring) {
    turnEl.textContent = state.scoring ? "Mark dead stones" : "Game over";
  } else {
    const who = go.turn === BLACK ? "Black" : "White";
    const you = state.mode === "computer" ? (go.turn === state.human ? " · you" : " · computer") : "";
    turnEl.textContent = `${who} to play${you}`;
  }
  $("#turn-dot").className = "dot " + (go.turn === BLACK ? "black" : "white");
  $("#cap-b").textContent = go.captures[BLACK];
  $("#cap-w").textContent = go.captures[WHITE];

  // live estimate from influence
  if (state.showTerritory && !state.scoring) {
    const inf = go.influence();
    let b = 0, w = 0;
    for (const v of inf) { if (v > 0) b++; else if (v < 0) w++; }
    const margin = b - (w + go.komi);
    const lead = margin >= 0 ? `Black +${margin.toFixed(1)}` : `White +${(-margin).toFixed(1)}`;
    $("#estimate").textContent = `est. ${lead}`;
  } else {
    $("#estimate").textContent = "";
  }
  $("#confirm-btn").classList.toggle("ready", !!state.candidate);
}

// ---- Move handling ---------------------------------------------------------
function place(x, y) {
  const go = state.go;
  const res = go.play(x, y);
  if (!res.ok) { flash(res.reason); buzz(30); return false; }
  state.candidate = null; state.hint = null;
  clack(res.captures.length ? "capture" : "place"); buzz(res.captures.length ? 22 : 10);
  for (const s of res.captures) state.anims.push({ x: s % go.size, y: (s / go.size) | 0, t: performance.now() });
  afterMove();
  return true;
}

function afterMove() {
  updateHud();
  if (state.go.ended) { enterScoring(); return; }
  if (state.mode === "computer" && state.go.turn !== state.human) {
    state.busy = true;
    setTimeout(aiMove, 480 + Math.random() * 360);
  }
}

function aiMove() {
  const go = state.go;
  if (go.ended) { state.busy = false; return; }
  const m = chooseMove(go, go.turn, state.level);
  if (m.pass) { go.pass(); clack("place"); if (go.ended) enterScoring(); }
  else {
    const res = go.play(m.x, m.y);
    if (res.ok) {
      clack(res.captures.length ? "capture" : "place");
      for (const s of res.captures) state.anims.push({ x: s % go.size, y: (s / go.size) | 0, t: performance.now() });
    }
  }
  state.busy = false;
  updateHud();
  if (go.ended) enterScoring();
}

function flash(msg) {
  const el = $("#flash"); el.textContent = msg; el.classList.add("show");
  clearTimeout(flash._t); flash._t = setTimeout(() => el.classList.remove("show"), 1200);
}

// ---- Interaction -----------------------------------------------------------
let pressing = false;
function onDown(e) {
  if (state.busy || state.go.ended) { if (state.scoring) onScoreTap(e); return; }
  audio();
  pressing = true;
  const p = pointer(e);
  const hit = nearest(p.x, p.y);
  if (hit) { state.candidate = hit; updateHud(); }
  e.preventDefault();
}
function onMove(e) {
  if (!pressing || state.busy) return;
  const p = pointer(e);
  const hit = nearest(p.x, p.y);
  if (hit) { state.candidate = hit; updateHud(); }
}
function onUp(e) {
  if (!pressing) return; pressing = false;
  if (state.busy || !state.candidate) return;
  if (!state.confirmMoves) { commit(); }
  // in confirm mode the stone stays pending; user taps Confirm button
}
function commit() {
  if (!state.candidate) return;
  const { x, y } = state.candidate;
  place(x, y);
}
function pointer(e) {
  const t = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  return { x: t.clientX, y: t.clientY };
}

// ---- Scoring flow ----------------------------------------------------------
function enterScoring() {
  state.scoring = true; state.reveal = 0; state.candidate = null;
  $("#score-panel").classList.add("show");
  $("#play-actions").classList.add("hidden");
  updateScorePanel();
  updateHud();
}
function onScoreTap(e) {
  const p = pointer(e);
  const hit = nearest(p.x, p.y);
  if (!hit) return;
  const go = state.go;
  if (go.get(hit.x, hit.y) === EMPTY) return;
  // toggle whole group dead/alive
  const grp = go.group(hit.x, hit.y);
  const anyDead = grp.stones.some((s) => state.dead.has(s));
  for (const s of grp.stones) { if (anyDead) state.dead.delete(s); else state.dead.add(s); }
  state.reveal = 0;
  buzz(8); clack("place");
  updateScorePanel();
}
function updateScorePanel() {
  const sc = state.go.score(state.dead);
  const win = sc.winner === BLACK ? "Black" : "White";
  const by = Math.abs(sc.margin).toFixed(1);
  const html =
    `Black <b>${sc.blackScore.toFixed(0)}</b> · White <b>${sc.whiteScore.toFixed(1)}</b><br>` +
    `<span class="win">${win} wins by ${by}</span>`;
  $("#score-result").innerHTML = html;
  const r2 = $("#score-result2"); if (r2) r2.innerHTML = html;
}

// ---- Menu / lifecycle ------------------------------------------------------
function newGame(opts) {
  Object.assign(state, opts);
  state.go = new Go(opts.size);
  state.candidate = null; state.hint = null;
  state.scoring = false; state.dead = new Set(); state.reveal = 0; state.busy = false;
  $("#score-panel").classList.remove("show");
  $("#play-actions").classList.remove("hidden");
  $("#menu").classList.remove("show");
  $("#game").classList.add("show");
  layout();
  updateHud();
  if (!raf) raf = requestAnimationFrame(loop);
  // If human is white vs computer, let the computer (black) open.
  if (state.mode === "computer" && state.go.turn !== state.human) {
    state.busy = true; setTimeout(aiMove, 500);
  }
}

function wireUi() {
  // tactile press feedback for all buttons
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn"); if (b) buzz(6);
  });

  // Menu: board size + opponent selection
  let sel = { size: 9, mode: "computer", level: "easy", human: BLACK };
  document.querySelectorAll("[data-size]").forEach((b) =>
    b.addEventListener("click", () => { sel.size = +b.dataset.size; markGroup("[data-size]", b); }));
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      sel.mode = b.dataset.mode; markGroup("[data-mode]", b);
      $("#level-row").classList.toggle("hidden", sel.mode !== "computer");
    }));
  document.querySelectorAll("[data-level]").forEach((b) =>
    b.addEventListener("click", () => { sel.level = b.dataset.level; markGroup("[data-level]", b); }));
  document.querySelectorAll("[data-color]").forEach((b) =>
    b.addEventListener("click", () => { sel.human = +b.dataset.color; markGroup("[data-color]", b); }));

  $("#start").addEventListener("click", () => { audio(); newGame({ ...sel }); });

  // Play actions
  $("#confirm-btn").addEventListener("click", () => { if (!state.busy) commit(); });
  $("#pass-btn").addEventListener("click", () => {
    if (state.busy || state.go.ended) return;
    state.go.pass(); state.candidate = null; clack("place"); buzz(10);
    afterMove();
  });
  $("#undo-btn").addEventListener("click", () => {
    if (state.busy) return;
    state.go.undo();
    if (state.mode === "computer" && state.go.turn !== state.human) state.go.undo(); // undo the pair
    state.candidate = null; state.hint = null; buzz(10); updateHud();
  });
  $("#hint-btn").addEventListener("click", () => {
    if (state.busy || state.go.ended) return;
    const m = chooseMove(state.go, state.go.turn, "steady");
    state.hint = m.pass ? null : { x: m.x, y: m.y };
    if (!m.pass) buzz(8);
  });

  // Toggles
  bindToggle("#t-territory", "showTerritory");
  bindToggle("#t-atari", "showAtari");
  bindToggle("#t-confirm", "confirmMoves");

  // Score panel
  $("#finish-btn").addEventListener("click", () => {
    state.reveal = 0; updateScorePanel();
    $("#score-final").classList.add("show");
  });
  $("#rematch-btn").addEventListener("click", () => {
    $("#score-final").classList.remove("show");
    newGame({ size: state.go.size, mode: state.mode, level: state.level, human: state.human });
  });
  $("#menu-btn").addEventListener("click", () => {
    $("#game").classList.remove("show"); $("#menu").classList.add("show");
  });
  $("#score-menu-btn").addEventListener("click", () => {
    $("#score-final").classList.remove("show"); $("#score-panel").classList.remove("show");
    $("#game").classList.remove("show"); $("#menu").classList.add("show");
  });

  // Canvas input
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("resize", () => { if (state.go) { layout(); } });
}

function bindToggle(sel, key) {
  const el = $(sel);
  el.classList.toggle("on", state[key]);
  el.addEventListener("click", () => { state[key] = !state[key]; el.classList.toggle("on", state[key]); buzz(8); updateHud(); });
}
function markGroup(sel, active) {
  document.querySelectorAll(sel).forEach((b) => b.classList.toggle("sel", b === active));
}

wireUi();
