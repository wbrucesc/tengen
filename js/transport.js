// transport.js — Live multiplayer over Supabase, using plain table polling.
// Room discovery + move sync go through the `games` and `moves` tables; clients
// poll for new rows. No Realtime/replication/broadcast needed — works on any
// Supabase project with just the tables + RLS from SUPABASE_SETUP.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BLACK, WHITE } from "./engine.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const POLL_MS = 1200;

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let _client = null;
function client() {
  if (!_client) {
    if (!isConfigured()) throw new Error("Supabase not configured — see SUPABASE_SETUP.md");
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

export function sessionId() {
  let id = localStorage.getItem("tengen-sid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("tengen-sid", id); }
  return id;
}

function genCode() {
  // 6 chars, avoiding visually ambiguous letters (0/O, 1/I/L)
  const CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += CH[(Math.random() * CH.length) | 0];
  return c;
}

export class OnlineTransport {
  constructor(gameId, myColor, code, settings) {
    this._gameId = gameId;
    this._myColor = myColor;
    this._code = code;
    this._settings = settings || null; // {size, variant} — filled in for guest
    this._cbs = {};
    this._timer = null;
    this._lastId = 0;        // highest moves.id applied so far
    this._round = 1;         // increments on each rematch
    this._joinedSeen = false;
    this._ended = false;
  }

  get myColor() { return this._myColor; }
  get code() { return this._code; }
  get settings() { return this._settings; }

  // Host: create a new game in the DB.
  static async host(size, variant) {
    const c = client(), sid = sessionId();
    let code, gameId;
    for (let i = 0; i < 5; i++) {
      code = genCode();
      const { data, error } = await c.from("games").insert({
        code, board_size: size, variant, status: "waiting", black_id: sid,
      }).select("id").single();
      if (!error) { gameId = data.id; break; }
      if (error.code !== "23505") throw new Error(error.message); // unique violation → retry
    }
    if (!gameId) throw new Error("Failed to create room — try again.");
    return new OnlineTransport(gameId, BLACK, code);
  }

  // Guest: look up game by code and claim the white seat.
  static async join(code) {
    const c = client(), sid = sessionId();
    const { data: game, error } = await c.from("games")
      .select("id, board_size, variant, status")
      .eq("code", code.toUpperCase().trim())
      .single();
    if (error || !game) throw new Error("Room not found — check the code.");
    if (game.status !== "waiting") throw new Error("Game already in progress or finished.");
    const { error: e2 } = await c.from("games")
      .update({ white_id: sid, status: "playing" })
      .eq("id", game.id).eq("status", "waiting");
    if (e2) throw new Error("Could not join — room may be taken.");
    return new OnlineTransport(
      game.id, WHITE, code.toUpperCase().trim(),
      { size: game.board_size, variant: game.variant }
    );
  }

  // Begin polling for opponent-join, incoming moves, rematch, and game end.
  subscribe({ onMove, onOpponentJoined, onGameEnd, onConnLost, onRematch }) {
    this._cbs = { onMove, onOpponentJoined, onGameEnd, onConnLost, onRematch };
    this._poll();
    this._timer = setInterval(() => this._poll(), POLL_MS);
  }

  async _poll() {
    const c = client();
    try {
      // Game row: drives host's opponent-joined and either side's game-end.
      const { data: g } = await c.from("games")
        .select("status, winner").eq("id", this._gameId).single();
      if (g) {
        if (this._myColor === BLACK && !this._joinedSeen &&
            (g.status === "playing" || g.status === "done")) {
          this._joinedSeen = true;
          this._cbs.onOpponentJoined?.({});
        }
        if (!this._ended && g.status === "done") {
          this._ended = true;
          this._cbs.onGameEnd?.(g);
        }
      }

      // New rows since the last we applied (ordered by the auto id). A row with
      // color 0 is a control row: a rematch signal carrying the new round in x.
      const { data: moves } = await c.from("moves")
        .select("id, color, x, y, is_pass")
        .eq("game_id", this._gameId)
        .gt("id", this._lastId)
        .order("id", { ascending: true });
      if (moves) for (const m of moves) {
        if (m.id > this._lastId) this._lastId = m.id;
        if (m.color === 0) {
          // Rematch: swap seats and start fresh, once per new round.
          if (m.x > this._round) {
            this._round = m.x;
            this._myColor = this._myColor === BLACK ? WHITE : BLACK;
            this._ended = false;
            this._cbs.onRematch?.({ color: this._myColor });
          }
          continue;
        }
        if (m.color !== this._myColor) this._cbs.onMove?.(m);
      }
    } catch { /* transient network error — next tick retries */ }
  }

  // `seq` only needs to satisfy the table's NOT NULL + unique(game_id, seq);
  // application order is driven by the auto-increment id, so a random int is fine.
  _randSeq() { return (Math.random() * 2000000000) | 0; }

  async sendMove(x, y) {
    const { error } = await client().from("moves").insert({
      game_id: this._gameId, seq: this._randSeq(),
      color: this._myColor, x, y, is_pass: false,
    });
    if (error) throw new Error(error.message);
  }

  async sendPass() {
    const { error } = await client().from("moves").insert({
      game_id: this._gameId, seq: this._randSeq(),
      color: this._myColor, x: null, y: null, is_pass: true,
    });
    if (error) throw new Error(error.message);
  }

  async endGame(winner) {
    try {
      await client().from("games").update({ status: "done", winner }).eq("id", this._gameId);
    } catch {}
  }

  // Ask for a rematch in the same room. Clears the game row back to "playing"
  // and drops a control row (color 0) carrying the next round number; both
  // clients pick it up on their next poll, swap colors, and restart together.
  async requestRematch() {
    const round = this._round + 1;
    const c = client();
    try { await c.from("games").update({ status: "playing", winner: null }).eq("id", this._gameId); } catch {}
    const { error } = await c.from("moves").insert({
      game_id: this._gameId, seq: this._randSeq(),
      color: 0, x: round, y: null, is_pass: false,
    });
    if (error) throw new Error(error.message);
  }

  disconnect() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}
