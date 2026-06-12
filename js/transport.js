// transport.js — Live multiplayer via Supabase Realtime.
// Host creates a room (gets a code), guest joins by entering the code.
// Moves are inserted into the "moves" table; Realtime pushes them to the opponent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BLACK, WHITE } from "./engine.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
    this._outSeq = 0;
    this._channel = null;
    this._moveCb = null;
    this._joinedCb = null;
    this._endCb = null;
    this._connCb = null;
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

  // Subscribe to live events. Call once; callbacks fire as moves/status come in.
  subscribe({ onMove, onOpponentJoined, onGameEnd, onConnLost }) {
    this._moveCb = onMove;
    this._joinedCb = onOpponentJoined;
    this._endCb = onGameEnd;
    this._connCb = onConnLost;

    this._channel = client()
      .channel(`tengen:${this._gameId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "moves",
        filter: `game_id=eq.${this._gameId}`,
      }, (p) => {
        if (p.new.color !== this._myColor) this._moveCb?.(p.new);
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "games",
        filter: `id=eq.${this._gameId}`,
      }, (p) => {
        const g = p.new;
        // Host gets notified when guest joins (status flips to "playing")
        if (g.status === "playing" && this._myColor === BLACK) this._joinedCb?.(g);
        if (g.status === "done") this._endCb?.(g);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") this._connCb?.();
      });
  }

  async sendMove(x, y) {
    const { error } = await client().from("moves").insert({
      game_id: this._gameId, seq: this._outSeq++,
      color: this._myColor, x, y, is_pass: false,
    });
    if (error) throw new Error(error.message);
  }

  async sendPass() {
    const { error } = await client().from("moves").insert({
      game_id: this._gameId, seq: this._outSeq++,
      color: this._myColor, x: null, y: null, is_pass: true,
    });
    if (error) throw new Error(error.message);
  }

  // Mark the game done in the DB (used for resign; two-pass endings are self-evident).
  async endGame(winner) {
    const { error } = await client().from("games")
      .update({ status: "done", winner })
      .eq("id", this._gameId);
    if (error) throw new Error(error.message);
  }

  disconnect() {
    if (this._channel) {
      try { client().removeChannel(this._channel); } catch {}
      this._channel = null;
    }
  }
}
