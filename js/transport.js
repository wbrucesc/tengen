// transport.js — Live multiplayer via Supabase Realtime.
// Room discovery uses the `games` table (codes); Presence tracks who's in the
// room (opponent-joined), and Broadcast carries live moves/passes/resign —
// both work on any Supabase project without database replication setup.
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
    this._channel = null;
    this._cbs = {};
    this._joinedSeen = false;
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

  // Subscribe to live events. Presence tracks who's in the room (so the host
  // learns when the guest arrives, regardless of connect order); Broadcast
  // carries the live moves/passes/resign.
  subscribe({ onMove, onOpponentJoined, onGameEnd, onConnLost }) {
    this._cbs = { onMove, onOpponentJoined, onGameEnd, onConnLost };

    this._channel = client().channel(`tengen:${this._gameId}`, {
      config: { broadcast: { self: false }, presence: { key: sessionId() } },
    });

    // Host watches presence for the guest (color WHITE) showing up.
    const checkPresence = () => {
      if (this._myColor !== BLACK || this._joinedSeen) return;
      const everyone = Object.values(this._channel.presenceState()).flat();
      if (everyone.some((p) => p.color === WHITE)) {
        this._joinedSeen = true;
        this._cbs.onOpponentJoined?.({});
      }
    };

    this._channel
      .on("broadcast", { event: "move" }, ({ payload }) => {
        if (payload.color !== this._myColor) this._cbs.onMove?.(payload);
      })
      .on("broadcast", { event: "end" }, ({ payload }) => {
        this._cbs.onGameEnd?.(payload);
      })
      .on("presence", { event: "sync" }, checkPresence)
      .on("presence", { event: "join" }, checkPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // Announce our seat so the other side's presence sees us.
          await this._channel.track({ color: this._myColor });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this._cbs.onConnLost?.();
        }
      });
  }

  async sendMove(x, y) {
    await this._channel.send({
      type: "broadcast", event: "move",
      payload: { color: this._myColor, x, y, is_pass: false },
    });
  }

  async sendPass() {
    await this._channel.send({
      type: "broadcast", event: "move",
      payload: { color: this._myColor, x: null, y: null, is_pass: true },
    });
  }

  // Resign / game end: tell the opponent, and best-effort record it in the DB.
  async endGame(winner) {
    if (this._channel) {
      this._channel.send({ type: "broadcast", event: "end", payload: { winner } });
    }
    try {
      await client().from("games").update({ status: "done", winner }).eq("id", this._gameId);
    } catch {}
  }

  disconnect() {
    if (this._channel) {
      try { client().removeChannel(this._channel); } catch {}
      this._channel = null;
    }
  }
}
