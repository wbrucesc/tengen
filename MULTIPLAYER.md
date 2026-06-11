# Multiplayer plan — "play a friend" online

Goal: let two people (e.g. on separate iPhones) play each other online — a live
game over a short **room code**, and later **async / correspondence** play with
a "your turn" notification.

## Why this is the easy case

Go is turn-based, latency-tolerant, and our `engine.js` is **pure and
deterministic**. So we never sync board pixels or game state — we sync *moves*
(a few bytes: "Black plays D4"). Both phones run the same engine and replay the
same move list to identical positions. That's about the simplest networking
problem there is, and it means the entire existing engine/UI is reused as-is.

## Architecture: a swappable "transport"

The app already has three move sources — pass-&-play, AI, and local. We add a
fourth, **remote**, behind one tiny interface so the game loop doesn't care
where a move comes from:

```js
// transport.js (planned)
interface Transport {
  send(move)              // {x,y} | {pass:true}  -> push my move to the backend
  onRemoteMove(cb)        // cb(move)             <- opponent's move arrives
  onStatus(cb)           // cb({state,players})  <- waiting/active/finished
  myColor                 // BLACK | WHITE
}
```

Rule of thumb to avoid divergence: **the backend's move log is the source of
truth.** A client writes its move, then applies it when it echoes back over the
realtime channel (optionally optimistic-apply locally first, keyed by move
sequence number). Each move carries `seq` so out-of-order/duplicate delivery is
trivially handled.

## Backend: recommendation = **Supabase**

Picked Supabase over Firebase as the primary backend:

- **Postgres + Realtime** — subscribe to row inserts; perfect for a move log.
- **Free tier** easily covers private play between friends.
- **Grows with us** — the same DB cleanly adds profiles, rank, game history, and
  **server-side move validation** later (run our engine in a Deno Edge Function
  so a tampered client can't cheat).
- **Anonymous auth** or even a random `clientId` in `localStorage` is enough for
  casual play behind an unguessable room code.

> Firebase is a fine alternative and has the slickest path to **FCM push**. The
> transport interface above keeps this swappable, so the choice isn't locked in.
> If async push becomes the priority before anything else, revisit Firebase.

### Data model (Supabase)

```
games
  id          uuid pk
  code        text unique         -- short shareable room code, e.g. "K7QM"
  board_size  int                 -- 9 | 13 | 19
  variant     text                -- 'capture' | 'territory'
  komi        numeric
  status      text                -- 'waiting' | 'active' | 'finished'
  black       text                -- player/client id
  white       text
  winner      text null
  created_at  timestamptz
  updated_at  timestamptz

moves
  id          uuid pk
  game_id     uuid fk -> games.id
  seq         int                 -- 0,1,2… strictly increasing per game
  color       int                 -- 1 black, 2 white
  x           int null
  y           int null
  is_pass     bool
  created_at  timestamptz
```

### Flow

1. **Host** creates a `games` row (generates `code`, picks a color), `status =
   'waiting'`, and shows the code.
2. **Guest** enters the code, claims the empty color, sets `status = 'active'`.
3. Each move = insert into `moves` with the next `seq`. Both clients are
   subscribed to `moves` for that `game_id` and apply inserts in `seq` order via
   the existing `Go.play()`.
4. Resign / two-pass / capture-win updates `games.status` + `winner`; both
   clients react via the `games` subscription.

## Phased delivery

- **Phase A — live room-code play.** Supabase Realtime; both players online.
  Host/join by code, moves sync live, resign + rematch. *(No Capacitor needed —
  works in the web app.)*
- **Phase B — async + "your turn" push.** Persist the game; when it's the
  opponent's turn, fire a push. This is the **one place Capacitor matters**:
  reliable APNs/FCM push (web push on iOS is flaky). Trigger via a Supabase Edge
  Function on move insert.
- **Phase C — depth.** Accounts, game history, rank, and **server-side move
  validation** (engine in an Edge Function) for anti-cheat / ranked play.

## Sequence vs the rest of the roadmap

Beginner experience first (Capture Go ✓, group inspector ✓, adaptive handicap,
learn path), then **Phase A** as the first multiplayer milestone. The transport
abstraction above is the only thing we keep in mind while building so the online
mode drops in without reworking the game loop.
