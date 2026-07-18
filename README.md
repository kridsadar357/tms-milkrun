# TMS Milkrun — Transport Management System

An intelligent milkrun Transport Management System (TH/EN bilingual) with
capacity-constrained auto-routing, Mapbox visualization, and cost analytics.

## Features

- **Auto Route (VRPTW solver)** — time-window + capacity nearest-neighbour with
  time-window-feasible 2-opt, respecting **both m³ and kg** capacity and each
  stop’s **delivery window** (waits if early, rejects if too late), with
  **multiple rounds per day**. A **metaheuristic optimization pass** (iterated
  local search with ruin-and-recreate) relocates/swaps stops and exchanges trucks
  between routes to **cut total cost and even out load** (the cheaper cost/km
  truck takes the longer route; fewer trucks when cheaper), escaping local optima
  while keeping every route capacity- and window-feasible, then **reinserts** any
  stop that now fits. Choose what it minimizes with **Optimize for: Lowest cost
  (฿, default) / Shortest distance / Balanced load**. It is **deterministic**
  (seeded) and stays well under a second even for ~60 stops. When road geometry
  is enabled it plans on a **real Mapbox road matrix** (Matrix API, tiled for
  large stop sets): cost and sequencing use true road **distances** and time
  windows / ETAs use true road **travel times** — not haversine or a constant
  speed — then it snaps the route polyline to roads via **Mapbox Directions**.
- **Multi-depot milkrun** — give a supplier a **destination plant** and Auto Route
  groups suppliers by plant and builds a loop that **starts and ends at that plant**
  (a `plant` location), so a truck only carries goods bound for one plant; the
  fleet is partitioned across plants. Suppliers with no plant use the global depot
  (single-depot mode). Road-snapping and manual edits respect each route's plant.
- **Fixed / Dynamic assignment** — each truck runs a **fixed cyclic route** (cyclic
  rotation) or is assigned **dynamically** by the optimizer.
- **Milkrun Analytics** — KPIs and charts for cyclic rotation, lead-time, loading
  efficiency, time-window compliance, returnable packaging, and flexibility.
- **Mapbox GL JS v3 map** — depot, delivery locations, and color-coded route lines
  with click-to-highlight per route and stop-sequence details (ETA per stop).
- **Master data**
  - **Delivery Locations** — code, EN/TH name, type (supplier/plant/warehouse/customer),
    **validated lat/long** (range check + Thailand plausibility warning), daily demand
    (m³/kg), service time.
  - **Trucks** — plate, type (4W/4WJ/6W/10W/Trailer with capacity presets),
    transport partner, capacity (m³ + kg), rounds/day, fixed cost/round, cost/km.
  - **Transport Partners** — code, name, contact, phone, email.
- **Cost Summary** — fixed/variable/total THB by route, truck, or partner,
  THB/m³ unit cost, daily total and ×22-day monthly estimate.
- **Dashboard** — KPI tiles, per-route capacity utilization, cost by partner.
- **TH/EN** — full Thai and English UI (react-i18next), persisted preference.
- All data persisted in the browser (localStorage) with sample EEC dataset
  (Chonburi/Rayong milkrun network) and reset/clear controls.

## Quick start

```bash
npm install
npm run dev     # runs BOTH the API server (:3001) and the web app (:5173)
```

Open http://localhost:5173 and **sign in**. Default accounts (seeded on first
run — **change them**): `admin/admin`, `dispatcher/dispatcher`, `viewer/viewer`.

> `npm run dev` uses `concurrently` to start the Neon-backed API server and the
> Vite dev server together. Use `npm run web` or `npm run server` to run them
> separately.

## Authentication & roles

The API is session-authenticated: login (`POST /api/login`) verifies a
scrypt-hashed password and sets an **httpOnly session cookie**; all data
endpoints require it. Roles come from the logged-in user and are enforced
server-side — **viewer is read-only**, **dispatcher** can plan/operate/bill,
**admin** can do everything (including reset). Admins get a **Users** page to
add/edit/delete accounts and reset passwords (can't remove yourself or the last
admin). Set a strong `AUTH_SECRET` and change the default passwords
(`ADMIN_PASSWORD`, …) in production. See [`SECURITY.md`](SECURITY.md).

## Data & persistence (Neon Postgres)

State is stored in **Neon Postgres**, not the browser. A small Express API
(`server/index.mjs`) owns the connection string (from `DATABASE_URL` in `.env`,
never exposed to the client) and serves the whole app state:

- `GET /api/state` — load everything (partners, trucks, drivers, locations,
  billings, settings, plan)
- `PUT /api/state` — debounced full-state upsert (transactional)

On first run the empty database is seeded from the built-in sample dataset. The
frontend (`src/lib/api.ts` + `initStore()` in `src/store.ts`) hydrates from the
API on startup and autosaves on every change. If the API is unreachable the app
still runs in-memory with the seed data. Vite proxies `/api` → `:3001`.

Tables: `partners`, `trucks`, `drivers`, `locations`, `billings` (each
`id text, doc jsonb`) plus a `singletons` table for `settings` and `plan`.

### Mapbox token

The map needs a Mapbox access token (free at
[account.mapbox.com](https://account.mapbox.com/access-tokens/)). Either:

- paste it in **Settings → Mapbox Access Token**, or
- copy `.env.example` to `.env` and set `VITE_MAPBOX_TOKEN=pk.…`

Without a token the app still works (planning uses haversine × 1.3 road factor);
the map pane shows a hint instead.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`: **lint → typecheck →
build** on Node 22.

## Deployment

The app deploys as a **single Node service** — in production the API server also
serves the built frontend (`dist/`) and provides an SPA fallback, so one origin
hosts everything (no separate static host, no CORS).

```bash
npm ci && npm run build   # produce dist/
npm start                 # NODE_ENV=production node server/index.mjs
```

Required env var: `DATABASE_URL` (Neon). Optional at build time:
`VITE_MAPBOX_TOKEN` (the token can also be entered in-app under Settings). The
host's `PORT` is used automatically.

- **Render** — `render.yaml` blueprint included: New → Blueprint → pick this
  repo, then set `DATABASE_URL` as a secret.
- **Docker** (Fly.io / Railway / Cloud Run / any container host):

  ```bash
  docker build -t tms-milkrun --build-arg VITE_MAPBOX_TOKEN=pk.… .
  docker run -p 3001:3001 -e DATABASE_URL='postgresql://…' tms-milkrun
  ```

## Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Mapbox GL JS 3 · Zustand 5 ·
i18next 26 · Express · pg (Neon Postgres)

## Architecture

```
src/
  lib/optimizer.ts    VRPTW engine (NN + 2-opt + ruin/recreate ILS: relocate/swap/truck-exchange)
  lib/matrix.ts       Mapbox Matrix API — real road distance + duration matrix (tiled)
  lib/directions.ts   Mapbox Directions road-snapping & re-pricing
  lib/geo.ts          haversine, bearing, lat/long validation
  store.ts            Zustand persisted store + seed data
  i18n.ts             EN/TH translations
  components/MapView.tsx   Mapbox GL map (markers, route layers)
  pages/              Dashboard, Planner, Locations, Trucks, Partners, Costs, Settings
```
