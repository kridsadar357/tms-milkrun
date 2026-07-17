# TMS Milkrun — Transport Management System

An intelligent milkrun Transport Management System (TH/EN bilingual) with
capacity-constrained auto-routing, Mapbox visualization, and cost analytics.

## Features

- **Auto Route (CVRP solver)** — sweep clustering + nearest-neighbour + 2-opt,
  respecting **both m³ and kg** capacity per truck, with **multiple rounds per day**.
  Optionally snaps routes to real roads via **Mapbox Directions** (real distance,
  duration, and cost re-pricing).
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

Open http://localhost:5173.

> `npm run dev` uses `concurrently` to start the Neon-backed API server and the
> Vite dev server together. Use `npm run web` or `npm run server` to run them
> separately.

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

## Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Mapbox GL JS 3 · Zustand 5 ·
i18next 26 · lucide-react

## Architecture

```
src/
  lib/optimizer.ts    CVRP auto-route engine (sweep + NN + 2-opt)
  lib/directions.ts   Mapbox Directions road-snapping & re-pricing
  lib/geo.ts          haversine, bearing, lat/long validation
  store.ts            Zustand persisted store + seed data
  i18n.ts             EN/TH translations
  components/MapView.tsx   Mapbox GL map (markers, route layers)
  pages/              Dashboard, Planner, Locations, Trucks, Partners, Costs, Settings
```
