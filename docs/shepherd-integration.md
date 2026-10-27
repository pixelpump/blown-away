# Shepherd integration (proposal)

Nothing here is built yet. This is the plan for Milestone 3, written down so the game's shape doesn't drift away from it. Adjust it once we look at Shepherd's actual Staff Board tables.

## 1. Frontend: lazy route

```tsx
// Shepherd: src/routes/play.tsx
const BlownAway = lazy(() => import('blown-away/embed/BlownAway'));

export function PlayRoute() {
  const navigate = useNavigate();
  const { data: challenge } = useDailyChallenge(); // { levelId, mode, weather, seed }
  return (
    <div className="fixed inset-0 z-50">
      <Suspense fallback={<Spinner />}>
        <BlownAway
          kicker="Today's challenge"
          {...challenge}
          onFinish={(run) => api.post('/games/blown-away/runs', run)}
          onExit={() => navigate(-1)}
        />
      </Suspense>
    </div>
  );
}
```

Phaser is about 370 KB gzipped and only loads when someone opens the game.

If there's no signal, `onFinish` should queue the run (for example in IndexedDB) and retry later. Phones in trucks lose signal all the time.

## 2. API: verify by replay

```ts
// Express: POST /api/games/blown-away/runs
import { replay } from 'blown-away/core';

const level = levels.get(body.levelId);                    // parsed once at boot
const challenge = await getDailyChallenge(orgId, today);   // the server decides seed/weather/mode
const result = replay(level, { mode: challenge.mode, weather: challenge.weather, seed: challenge.seed }, body.inputs);
if (!result.finished) return res.status(422).json({ error: 'run did not finish' });
await insertRun({ ...,  ticks: result.ticks, time_ms: result.timeMs });  // never trust body.timeMs
```

A replay of a one-minute run takes a few milliseconds. The input log is roughly 1–5 KB of JSON.

## 3. Database

```sql
create table game_daily_challenges (
  org_id      uuid not null,
  date        date not null,             -- in the org's timezone
  level_id    text not null,
  mode        text not null,
  weather     jsonb not null,            -- snapshot of the morning's real weather
  seed        int  not null,
  primary key (org_id, date)
);

create table game_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  user_id        uuid not null,
  challenge_date date,                   -- null for practice runs
  level_id       text not null,
  mode           text not null,
  ticks          int  not null,
  time_ms        int  not null,
  game_version   text not null,          -- tuning changes = new season
  inputs         jsonb not null,
  created_at     timestamptz not null default now()
);
create index on game_runs (org_id, challenge_date, time_ms);
```

- **RLS:** members can `select` runs in their own org. Only the API (service role) can `insert`.
- **Realtime:** the Staff Board subscribes to `game_runs` inserts for its org and refreshes the tile, with a "Nuala just took 1st 🍂" toast.

## 4. Contests

- **Daily:** each person's best `time_ms` on today's challenge, fastest first.
- **Weekly / monthly:** points from each day's placing (10 / 7 / 5 / 3 / 1, plus 1 for taking part), summed. This rewards playing every day over a single lucky run.
- **Day boundary:** midnight in the org's timezone.

## 5. Daily challenge generation

- On the first request each day per org, pick the level and mode from the date, and use a seed derived from org + date.
- Snapshot the weather the Staff Board already fetches into `{ wet, windX, windY, gustiness }`:
  - rain → `wet`
  - wind speed → gustiness and base wind, rotated to the real wind direction
- Store the snapshot so every run that day uses identical conditions.

## Packaging (to decide)

The game lives in its own repo. Options for Shepherd to consume it:

1. **Git dependency** (`"blown-away": "github:<owner>/blown-away#v0.2.0"`) with a small library build step (`core` → JS for the Express API, `embed` → ESM for the React app). This is the simplest.
2. A private npm package. Same idea, with nicer versioning.
