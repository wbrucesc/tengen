// app.js — UI, rendering, interaction, sound. Wires the engine to the screen.
import { Go, EMPTY, BLACK, WHITE, other, KOMI } from "./engine.js";
import { chooseMove, suggest } from "./ai.js";
import { OnlineTransport, isConfigured, sessionId } from "./transport.js";

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
  variant: "capture",    // "capture" | "territory"
  mode: "computer",      // "computer" | "friend" | "online"
  human: BLACK,          // which color the local player controls
  level: "easy",
  showTerritory: false,
  showAtari: true,
  confirmMoves: true,
  candidate: null,       // {x,y} pending confirmation
  hint: null,            // {x,y} suggested
  inspect: null,         // group inspector result
  scoring: false,
  dead: new Set(),
  reveal: 0,
  anims: [],
  busy: false,
  transport: null,       // OnlineTransport | null
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

  ctx.fillStyle = C.board;
  roundRect(ctx, 0, 0, geom.css, geom.css, cell * 0.35); ctx.fill();

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

  ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, cell * 0.035); ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    ctx.moveTo(toPx(0), toPx(i)); ctx.lineTo(toPx(size - 1), toPx(i));
    ctx.moveTo(toPx(i), toPx(0)); ctx.lineTo(toPx(i), toPx(size - 1));
  }
  ctx.stroke();
  ctx.fillStyle = C.line;
  for (const [sx, sy] of starPoints(size)) {
    ctx.beginPath(); ctx.arc(toPx(sx), toPx(sy), cell * 0.08, 0, 7); ctx.fill();
  }

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

  const r = cell * 0.46;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = go.get(x, y); if (v === EMPTY) continue;
    const dead = state.dead.has(go.idx(x, y));
    drawStone(toPx(x), toPx(y), r, v, dead);
  }

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

  const lm = go.lastMove;
  if (lm && !lm.pass && !state.scoring) {
    ctx.fillStyle = go.get(lm.x, lm.y) === BLACK ? C.cream : C.ink;
    ctx.beginPath(); ctx.arc(toPx(lm.x), toPx(lm.y), cell * 0.12, 0, 7); ctx.fill();
  }

  if (state.inspect && !state.scoring) {
    const ins = state.inspect;
    ctx.strokeStyle = C.green; ctx.lineWidth = cell * 0.05;
    for (const s of ins.stones) {
      const x = s % size, y = (s / size) | 0;
      ctx.beginPath(); ctx.arc(toPx(x), toPx(y), r + cell * 0.07, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = "rgba(31,74,58,.55)";
    for (const li of ins.libPoints) {
      const x = li % size, y = (li / size) | 0;
      ctx.beginPath(); ctx.arc(toPx(x), toPx(y), cell * 0.12, 0, 7); ctx.fill();
    }
    for (const ep of ins.eyePoints) {
      const x = ep % size, y = (ep / size) | 0;
      ctx.fillStyle = C.orange;
      ctx.beginPath(); ctx.arc(toPx(x), toPx(y), cell * 0.17, 0, 7); ctx.fill();
      ctx.fillStyle = C.cream;
      ctx.beginPath(); ctx.arc(toPx(x), toPx(y), cell * 0.07, 0, 7); ctx.fill();
    }
  }

  if (state.hint) {
    ctx.strokeStyle = C.green; ctx.lineWidth = cell * 0.08;
    ctx.beginPath(); ctx.arc(toPx(state.hint.x), toPx(state.hint.y), r, 0, 7); ctx.stroke();
  }

  if (state.candidate && !state.scoring) {
    const { x, y } = state.candidate;
    ctx.globalAlpha = 0.55;
    drawStone(toPx(x), toPx(y), r, go.turn, false);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.orange; ctx.lineWidth = cell * 0.06;
    ctx.beginPath(); ctx.arc(toPx(x), toPx(y), r + cell * 0.1, 0, 7); ctx.stroke();
  }

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
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.arc(cx + r * 0.12, cy + r * 0.16, r, 0, 7); ctx.fill();
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
    let you = "";
    if (state.mode === "computer") {
      you = go.turn === state.human ? " · you" : " · computer";
    } else if (state.mode === "online") {
      you = go.turn === state.human ? " · your turn" : " · opponent";
    }
    turnEl.textContent = `${who} to play${you}`;
  }
  $("#turn-dot").className = "dot " + (go.turn === BLACK ? "black" : "white");
  $("#cap-b").textContent = go.captures[BLACK];
  $("#cap-w").textContent = go.captures[WHITE];

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
  if (state.transport && go.turn !== state.human) {
    flash("Wait for your opponent's move"); buzz(30); return false;
  }
  const mover = go.turn;
  const res = go.play(x, y);
  if (!res.ok) { flash(res.reason); buzz(30); return false; }
  state.candidate = null; state.hint = null; clearInspect(); hideHintMsg();
  clack(res.captures.length ? "capture" : "place"); buzz(res.captures.length ? 22 : 10);
  for (const s of res.captures) state.anims.push({ x: s % go.size, y: (s / go.size) | 0, t: performance.now() });
  // Send the move first so the opponent receives it even when it ends the game
  // (e.g. the winning capture in Capture Go).
  if (state.transport) {
    state.transport.sendMove(x, y).catch(() => flash("Move may not have sent — check your connection"));
  }
  if (state.variant === "capture" && res.captures.length) { captureWin(mover); return true; }
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
  const mover = go.turn;
  const m = chooseMove(go, go.turn, state.level);
  if (m.pass) { go.pass(); clack("place"); }
  else {
    const res = go.play(m.x, m.y);
    if (res.ok) {
      clack(res.captures.length ? "capture" : "place");
      for (const s of res.captures) state.anims.push({ x: s % go.size, y: (s / go.size) | 0, t: performance.now() });
      if (state.variant === "capture" && res.captures.length) { captureWin(mover); return; }
    }
  }
  state.busy = false;
  updateHud();
  if (go.ended) enterScoring();
}

// Apply a move received from the opponent (delivered by transport polling).
function applyRemoteMove(row) {
  const go = state.go;
  if (!go || go.ended) return;
  const mover = row.color;
  if (row.is_pass) {
    go.pass();
    clack("place"); buzz(10);
    if (go.ended) { enterScoring(); } else { updateHud(); }
    return;
  }
  const res = go.play(row.x, row.y);
  if (!res.ok) {
    flash("Sync error — please refresh"); return;
  }
  clack(res.captures.length ? "capture" : "place"); buzz(res.captures.length ? 22 : 10);
  for (const s of res.captures) state.anims.push({ x: s % go.size, y: (s / go.size) | 0, t: performance.now() });
  if (state.variant === "capture" && res.captures.length) { captureWin(mover); return; }
  updateHud();
  if (go.ended) enterScoring();
}

// Opponent resigned or some other DB-driven game end.
function handleOnlineGameEnd(game) {
  if (!state.go || state.go._resignHandled) return;
  state.go.ended = true;
  state.go._resignHandled = true;
  const winner = game.winner;
  const won = state.transport && winner === state.transport.myColor;
  const winColor = winner === BLACK ? "Black" : "White";
  const r2 = $("#score-result2");
  if (r2) r2.innerHTML =
    `<span class="win">${winColor} wins by resignation</span><br>` +
    `<small>${won ? "Your opponent resigned." : "You resigned."}</small>`;
  $("#score-final").classList.add("show");
  if (state.transport) { state.transport.disconnect(); state.transport = null; }
  updateHud();
}

function captureWin(winner) {
  state.go.ended = true; state.busy = false;
  state.candidate = null; state.hint = null;
  const who = winner === BLACK ? "Black" : "White";
  const youWon = state.mode !== "friend" && winner === state.human;
  buzz(40); clack("capture");
  const r2 = $("#score-result2");
  if (r2) r2.innerHTML = `<span class="win">${who} wins!</span><br>first capture 🎯` +
    (state.mode !== "friend"
      ? `<br><small>${youWon ? "nice — you snagged the first stone!" : (state.mode === "online" ? "your opponent captured first!" : "the computer captured first — go again!")}</small>`
      : "");
  $("#score-final").classList.add("show");
  updateHud();
}

function flash(msg, kind = "error") {
  const el = $("#flash"); el.textContent = msg;
  el.className = "flash show" + (kind === "hint" ? " hint" : "");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove("show"), kind === "hint" ? 4800 : 1200);
}

// ---- Interaction -----------------------------------------------------------
let pressing = false;
function onDown(e) {
  if (state.scoring) { onScoreTap(e); return; }
  if (state.busy || state.go.ended) return;
  audio();
  // Online: silently block interaction when it's not your turn
  if (state.transport && state.go.turn !== state.human) {
    flash("Waiting for opponent…"); e.preventDefault(); return;
  }
  const p = pointer(e);
  const hit = nearest(p.x, p.y);
  if (hit && state.go.get(hit.x, hit.y) !== EMPTY) {
    showInspect(hit.x, hit.y); pressing = false; e.preventDefault(); return;
  }
  clearInspect();
  pressing = true;
  if (hit) { state.candidate = hit; updateHud(); }
  e.preventDefault();
}

function showInspect(x, y) {
  const d = state.go.inspect(x, y);
  if (!d) return;
  state.inspect = d; state.candidate = null;
  state.hint = null; hideHintMsg();
  buzz(8); clack("place");
  const label = d.color === BLACK ? "Black group" : "White group";
  const badge = { alive: "✓ alive", atari: "⚠ atari", "one-eye": "one eye", unsettled: "unsettled" }[d.status];
  $("#inspect").innerHTML =
    `<div class="ins-head"><b>${label}</b> · ${d.libs} liberties · ${d.eyes} eye${d.eyes === 1 ? "" : "s"}` +
    `<span class="ins-badge ${d.status}">${badge}</span></div>` +
    `<div class="ins-text">${d.text}</div><div class="ins-dismiss">tap to dismiss</div>`;
  $("#inspect").classList.add("show");
  updateHud();
}

function clearInspect() {
  if (!state.inspect) return;
  state.inspect = null;
  $("#inspect").classList.remove("show");
}

function showHint(reason) {
  clearInspect();
  $("#hint-msg").innerHTML =
    `<div class="ins-text">💡 ${reason}</div><div class="ins-dismiss">tap to dismiss</div>`;
  $("#hint-msg").classList.add("show");
}
function hideHintMsg() { $("#hint-msg").classList.remove("show"); }

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

// ---- Lobby (online mode setup) ---------------------------------------------
let _lobbyTransport = null;

function openLobby(sel) {
  _lobbyTransport = null;
  $("#lobby").classList.add("show");
  $("#lobby-host-view").style.display = "none";
  $("#lobby-join-view").style.display = "none";
  $("#lobby-connecting").style.display = "block";

  if (sel.onlineRole === "host") {
    OnlineTransport.host(sel.size, sel.variant)
      .then((t) => {
        _lobbyTransport = t;
        t.subscribe({
          onMove: applyRemoteMove,
          onOpponentJoined: () => {
            closeLobby();
            launchOnlineGame(t, sel);
          },
          onGameEnd: handleOnlineGameEnd,
          onConnLost: () => flash("Connection lost — please refresh"),
        });
        $("#lobby-code").textContent = t.code;
        $("#lobby-connecting").style.display = "none";
        $("#lobby-host-view").style.display = "block";
      })
      .catch((e) => { closeLobby(); flash(e.message || "Could not create room"); });
  } else {
    const code = sel.onlineCode;
    $("#lobby-connecting").style.display = "none";
    $("#lobby-join-view").style.display = "block";
    OnlineTransport.join(code)
      .then((t) => {
        _lobbyTransport = t;
        t.subscribe({
          onMove: applyRemoteMove,
          onOpponentJoined: () => {},
          onGameEnd: handleOnlineGameEnd,
          onConnLost: () => flash("Connection lost — please refresh"),
        });
        closeLobby();
        launchOnlineGame(t, { ...sel, ...t.settings });
      })
      .catch((e) => { closeLobby(); flash(e.message || "Could not join game"); });
  }
}

function closeLobby() {
  $("#lobby").classList.remove("show");
}

function launchOnlineGame(transport, settings) {
  if (state.transport && state.transport !== transport) state.transport.disconnect();
  state.transport = transport;
  newGame({
    variant: settings.variant,
    size: settings.size,
    mode: "online",
    human: transport.myColor,
  });
}

// ---- Menu / lifecycle ------------------------------------------------------
function newGame(opts) {
  // Starting a local game (computer/friend) tears down any lingering online
  // transport. Online launches keep the transport that launchOnlineGame set.
  if (opts.mode !== "online" && state.transport) {
    state.transport.disconnect(); state.transport = null;
  }
  Object.assign(state, opts);

  state.go = new Go(opts.size);
  state.candidate = null; state.hint = null; clearInspect(); hideHintMsg();
  state.scoring = false; state.dead = new Set(); state.reveal = 0; state.busy = false;

  const cap = state.variant === "capture";
  if (cap) state.showTerritory = false;
  const tg = $("#t-territory");
  tg.classList.toggle("gone", cap);
  tg.classList.toggle("on", state.showTerritory);
  $("#pass-btn").classList.toggle("gone", cap);
  const obj = $("#objective");
  obj.classList.toggle("show", cap);
  obj.textContent = "🎯 First to capture a stone wins";

  const isOnline = state.mode === "online";
  $("#undo-btn").classList.toggle("gone", isOnline);
  $("#resign-btn").classList.toggle("gone", !isOnline);

  const rematchBtn = $("#rematch-btn");
  if (rematchBtn) rematchBtn.textContent = isOnline ? "new game" : "rematch";

  $("#score-final").classList.remove("show");
  $("#score-panel").classList.remove("show");
  $("#play-actions").classList.remove("hidden");
  $("#menu").classList.remove("show");
  $("#game").classList.add("show");
  layout();
  updateHud();
  if (!raf) raf = requestAnimationFrame(loop);

  if (state.mode === "computer" && state.go.turn !== state.human) {
    state.busy = true; setTimeout(aiMove, 500);
  }
}

// ---- UI wiring -------------------------------------------------------------
function wireUi() {
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn"); if (b) buzz(6);
  });

  let sel = { variant: "capture", size: 9, mode: "computer", level: "easy", human: BLACK, onlineRole: "host", onlineCode: "" };

  document.querySelectorAll("[data-variant]").forEach((b) =>
    b.addEventListener("click", () => { sel.variant = b.dataset.variant; markGroup("[data-variant]", b); }));
  document.querySelectorAll("[data-size]").forEach((b) =>
    b.addEventListener("click", () => { sel.size = +b.dataset.size; markGroup("[data-size]", b); }));
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      sel.mode = b.dataset.mode; markGroup("[data-mode]", b);
      const isComp = sel.mode === "computer", isOnline = sel.mode === "online";
      $("#level-row").classList.toggle("hidden", !isComp);
      $("#online-row").classList.toggle("hidden", !isOnline);
    }));
  document.querySelectorAll("[data-level]").forEach((b) =>
    b.addEventListener("click", () => { sel.level = b.dataset.level; markGroup("[data-level]", b); }));
  document.querySelectorAll("[data-color]").forEach((b) =>
    b.addEventListener("click", () => { sel.human = +b.dataset.color; markGroup("[data-color]", b); }));

  document.querySelectorAll("[data-online-role]").forEach((b) =>
    b.addEventListener("click", () => {
      sel.onlineRole = b.dataset.onlineRole; markGroup("[data-online-role]", b);
      $("#join-code-input").classList.toggle("hidden", sel.onlineRole !== "join");
    }));

  $("#join-code-input").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
    sel.onlineCode = e.target.value;
  });

  $("#start").addEventListener("click", () => {
    audio();
    if (sel.mode === "online") {
      if (!isConfigured()) {
        flash("Online play needs Supabase — see SUPABASE_SETUP.md");
        return;
      }
      if (sel.onlineRole === "join") {
        const code = sel.onlineCode.trim();
        if (code.length !== 6) { flash("Enter the 6-character room code"); return; }
      }
      openLobby(sel);
    } else {
      newGame({ ...sel });
    }
  });

  $("#confirm-btn").addEventListener("click", () => { if (!state.busy) commit(); });
  $("#pass-btn").addEventListener("click", () => {
    if (state.busy || state.go.ended) return;
    if (state.transport && state.go.turn !== state.human) {
      flash("Waiting for opponent…"); return;
    }
    state.go.pass(); state.candidate = null; clack("place"); buzz(10);
    if (state.transport) {
      state.transport.sendPass().catch(() => flash("Pass may not have sent — check connection"));
    }
    afterMove();
  });
  $("#undo-btn").addEventListener("click", () => {
    if (state.busy) return;
    state.go.undo();
    if (state.mode === "computer" && state.go.turn !== state.human) state.go.undo();
    state.candidate = null; state.hint = null; buzz(10); updateHud();
  });
  $("#hint-btn").addEventListener("click", () => {
    if (state.busy || state.go.ended) return;
    if (state.transport && state.go.turn !== state.human) {
      flash("Hints are for your turn"); return;
    }
    const m = suggest(state.go, state.go.turn);
    state.hint = m.pass ? null : { x: m.x, y: m.y };
    showHint(m.reason);
    buzz(8);
  });

  $("#resign-btn").addEventListener("click", () => {
    if (!state.transport || state.go.ended) return;
    $("#resign-overlay").classList.add("show");
  });
  $("#resign-confirm-btn").addEventListener("click", async () => {
    $("#resign-overlay").classList.remove("show");
    if (!state.transport) return;
    const winner = other(state.transport.myColor);
    state.transport.endGame(winner).catch(() => {});
    handleOnlineGameEnd({ winner });
  });
  $("#resign-cancel-btn").addEventListener("click", () => {
    $("#resign-overlay").classList.remove("show");
  });

  bindToggle("#t-territory", "showTerritory");
  bindToggle("#t-atari", "showAtari");
  bindToggle("#t-confirm", "confirmMoves");

  $("#finish-btn").addEventListener("click", () => {
    state.reveal = 0; updateScorePanel();
    $("#score-final").classList.add("show");
  });
  $("#rematch-btn").addEventListener("click", () => {
    if (state.mode === "online") {
      if (state.transport) { state.transport.disconnect(); state.transport = null; }
      $("#score-final").classList.remove("show");
      $("#game").classList.remove("show"); $("#menu").classList.add("show");
      return;
    }
    $("#score-final").classList.remove("show");
    newGame({ variant: state.variant, size: state.go.size, mode: state.mode, level: state.level, human: state.human });
  });
  $("#menu-btn").addEventListener("click", () => {
    if (state.transport) { state.transport.disconnect(); state.transport = null; }
    $("#game").classList.remove("show"); $("#menu").classList.add("show");
  });
  $("#score-menu-btn").addEventListener("click", () => {
    if (state.transport) { state.transport.disconnect(); state.transport = null; }
    $("#score-final").classList.remove("show"); $("#score-panel").classList.remove("show");
    $("#game").classList.remove("show"); $("#menu").classList.add("show");
  });

  $("#lobby-cancel").addEventListener("click", () => {
    closeLobby();
    if (_lobbyTransport) { _lobbyTransport.disconnect(); _lobbyTransport = null; }
  });

  $("#inspect").addEventListener("click", clearInspect);
  $("#hint-msg").addEventListener("click", hideHintMsg);

  const openGuide = () => $("#guide").classList.add("show");
  $("#guide-btn").addEventListener("click", openGuide);
  $("#help-btn").addEventListener("click", openGuide);
  $("#guide-close").addEventListener("click", () => $("#guide").classList.remove("show"));

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
