# Supabase Setup — Online Multiplayer

Tengen uses Supabase for real-time move sync. You need a free Supabase project.
Setup takes about 10 minutes.

## 1. Create a Supabase project

Go to https://supabase.com → "New project". Choose any name and region. Free tier is fine.

## 2. Run the SQL below

In your project dashboard → **SQL Editor** → **New query**, paste and run this entire block:

```sql
-- Games table: one row per match
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  board_size  int  not null default 9,
  variant     text not null default 'territory',
  status      text not null default 'waiting',  -- waiting | playing | done
  black_id    text,
  white_id    text,
  winner      int,   -- 1 = Black, 2 = White
  created_at  timestamptz default now()
);

-- Moves table: one row per stone placed or pass
create table if not exists moves (
  id        bigint generated always as identity primary key,
  game_id   uuid references games(id) on delete cascade,
  seq       int  not null,
  color     int  not null,   -- 1 = Black, 2 = White
  x         int,             -- null if pass
  y         int,
  is_pass   boolean not null default false,
  created_at timestamptz default now(),
  unique (game_id, seq)
);

-- Row-level security (open for Phase A — no accounts required)
alter table games enable row level security;
alter table moves  enable row level security;

create policy "public read games"   on games for select using (true);
create policy "public insert games" on games for insert with check (true);
create policy "public update games" on games for update using (true);
create policy "public read moves"   on moves for select using (true);
create policy "public insert moves" on moves for insert with check (true);

-- Enable Realtime for live move delivery
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table moves;
```

## 3. Get your credentials

In the dashboard → **Settings** → **API**:

- **Project URL** — looks like `https://xyzxyz.supabase.co`
- **anon / public key** — starts with `eyJ…`

## 4. Fill them in

Edit `js/config.js`:

```js
export const SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ…your anon key…";
```

Deploy (push to the branch, Pages will rebuild), then reload the app. The
**online** chip will now be active in the menu.

## How it works (Phase A)

- **Host** picks game settings → taps **Start** → gets a 6-character room code
- **Host** shares the code (iMessage, text, etc.)
- **Guest** taps **online → join** → enters the code → game starts on both devices
- Moves sync via Supabase Realtime (Postgres Change Data Capture)
- Either player can **resign** from the actions bar; two passes end the game normally
- Session IDs are stored in `localStorage`; no accounts required

## Stale games cleanup (optional)

Old "waiting" games (host left before anyone joined) accumulate. You can clean them
up with a scheduled SQL job in Supabase or just run occasionally:

```sql
delete from games where status = 'waiting' and created_at < now() - interval '2 hours';
```
