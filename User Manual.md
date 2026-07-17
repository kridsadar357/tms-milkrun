# TMS Milkrun — User Manual

**Transport Management System (Milkrun) · ระบบบริหารจัดการการขนส่ง**

Version 1.0 · Bilingual (English / ไทย)

> This manual is written in Markdown so it can be converted to PDF. To produce a
> PDF, open it in any Markdown viewer and “Print → Save as PDF”, or run a
> converter such as `pandoc "User Manual.md" -o "User-Manual.pdf"`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Installation & Setup](#2-installation--setup)
3. [Navigating the App](#3-navigating-the-app)
4. [Master Data](#4-master-data)
5. [Route Planner](#5-route-planner)
6. [Operations (Trip Execution)](#6-operations-trip-execution)
7. [Incident Log](#7-incident-log)
8. [Cost Summary](#8-cost-summary)
9. [Billing & Payments](#9-billing--payments)
10. [Printed Documents](#10-printed-documents)
11. [Visual Truck 3D & Products](#11-visual-truck-3d--products)
12. [Dashboard & Alerts](#12-dashboard--alerts)
13. [Settings](#13-settings)
14. [Data & Persistence (Neon Postgres)](#14-data--persistence-neon-postgres)
15. [Import / Export](#15-import--export)
16. [Troubleshooting & FAQ](#16-troubleshooting--faq)
17. [Glossary](#17-glossary)

---

## 1. Overview

TMS Milkrun is a web application for planning and running **milkrun** transport
operations — repeated collection/delivery loops between a depot and a set of
supplier, plant, warehouse, and customer locations.

**Key capabilities**

- **Auto Route** — capacity-constrained optimizer (m³ **and** kg), multiple
  rounds per truck per day, snapped to real roads via Mapbox.
- **Interactive editing** — drag to reorder stops, reassign a stop to another
  truck, lock a route, and run “what-if” fleet scenarios with before/after
  savings.
- **Operations** — trip status workflow, proof of delivery (photo/signature),
  ETA vs. actual delay tracking, printable driver route sheets.
- **Finance** — partner rate cards, Thai VAT 7% / withholding tax 1%, invoices,
  monthly statements, and a dispatch manifest.
- **Bilingual** — full Thai and English UI, Buddhist-era dates on documents.
- **Light & dark themes**, **role-based access** (admin/dispatcher/viewer), a
  persisted **activity log**, and **CSV import**.
- **Real database** — all data is stored in Neon Postgres via a small API
  server.

The sample dataset models an EEC (Chonburi/Rayong) network with an AISIN depot
at Amata City Chonburi.

---

## 2. Installation & Setup

### Requirements

- Node.js 20+ (developed on Node 22)
- A Neon Postgres connection string (or any Postgres database)
- A Mapbox access token (free at <https://account.mapbox.com/access-tokens/>)

### Configure environment

Copy `.env.example` to `.env` and fill in:

```
VITE_MAPBOX_TOKEN=pk.your_mapbox_token
DATABASE_URL=postgresql://user:password@host.neon.tech/neondb?sslmode=require
```

- `VITE_MAPBOX_TOKEN` shows the map. It can also be entered later in **Settings**.
- `DATABASE_URL` is used **only by the API server** and is never exposed to the
  browser.

### Install & run

```bash
npm install
npm run dev      # starts BOTH the API server (:3001) and the web app (:5173)
```

Open <http://localhost:5173>.

- `npm run web` — run only the web app.
- `npm run server` — run only the API server.
- `npm run seed` — insert the sample dataset into Neon (`--force` to wipe + reseed).
- `npm run build` — type-check and produce a production build.

The sample dataset lives in **`server/seed.mjs`** and is inserted into Neon by
the API server on first run (when the database is empty). There is **no mock data
in the browser** — the app always loads real records from the database.

---

## 3. Navigating the App

The **sidebar** on the left groups pages:

- **Top:** Dashboard, Route Planner, Cost Summary, Billing & Payments
- **Operations:** Operations, Visual Truck 3D, Incident Log
- **Master Data:** Delivery Locations, Products, Trucks, Drivers, Transport
  Partners
- **Settings**

**Language switch** — buttons at the bottom of the sidebar (**EN / ไทย**). The
choice is saved to the database.

**Alert bell** (top of the sidebar) — a live count of things needing attention;
click an alert to jump straight to the relevant page. See
[§12](#12-dashboard--alerts).

---

## 4. Master Data

All master pages support **Add**, **Edit** (pencil), and **Delete** (trash), and
most support **Export CSV**.

### 4.1 Delivery Locations

Each location has:

| Field | Meaning |
|-------|---------|
| Code | Short identifier (e.g. `SUP-01`) |
| Name (EN) / Name (TH) | Bilingual names |
| Type | Supplier / Plant / Warehouse / Customer |
| Zone | Region grouping (e.g. Chonburi, Rayong) — filterable |
| Latitude / Longitude | **Validated** coordinates |
| Demand (m³/day), (kg/day) | Volume and weight to move |
| Service Time (min) | Handling time at the stop |
| Delivery Window | Earliest / latest time (HH:MM) |
| Delivery Days | Which weekdays the stop is served (empty = every day) — drives multi-day planning |

**Coordinate validation:** latitude must be −90…90 and longitude −180…180.
Coordinates outside Thailand raise a soft warning so you can double-check. Tip:
copy “lat, lng” straight from Google Maps.

Use the **Zone filter** and search box above the table to narrow the list.

### 4.2 Trucks

Plate number, type (4W / 4WJ / 6W / 10W / Trailer, with capacity presets),
transport partner, **capacity (m³ + kg)**, **rounds per day**, fixed cost per
round, and cost per km. The assigned **driver** is shown automatically.

### 4.3 Drivers

Code, EN/TH name, license number and class (e.g. ท.2 / บ.2), phone, and the
**assigned truck**. Driver names then appear on route cards, route sheets, and
the manifest.

### 4.4 Transport Partners

Contact details plus a **Rate Card & Terms** section:

- **Rate / km** — negotiated THB per km (leave 0 to bill by each truck’s own cost)
- **Rate / trip** — flat THB per round
- **Min. Charge** — invoice floor
- **Credit (days)** — payment terms, used for invoice due dates

and **Bank Details** (bank, account number, account name) used by the **Bank
Payment File** export ([§9](#9-billing--payments)).

### 4.5 Products

Optional catalogue of goods with physical **dimensions (W × L × H)** and
**weight**, linked to a supplier location. Used by the Visual Truck 3D load
planner ([§11](#11-visual-truck-3d--products)).

---

## 5. Route Planner

The heart of the system. It shows a **map** on the left and a **route list** on
the right.

### 5.1 Auto Route

Click **Auto Route**. The optimizer:

1. **Sweep-clusters** stops by bearing around the depot,
2. respects **both m³ and kg** capacity per truck, filling **rounds per day**,
3. sequences each trip with **nearest-neighbour + 2-opt**, then
4. (if a Mapbox token is set) **snaps each route to real roads** via the Mapbox
   Directions API and re-prices it with true distance.

Each **route card** shows truck, driver, partner, round, trip status, volume/
weight utilization, distance, duration, cost, and estimated **CO₂**.

Stops that don’t fit any truck appear under **Unassigned Stops** — add trucks or
rounds to absorb them.

### 5.2 The map

- Style switcher: **Streets / Satellite / Dark / Traffic**, plus **3D** tilt with
  building extrusion.
- Location dots are coloured by type; the depot is marked separately.
- **Click a route card** to highlight it on the map: the map flies to it, other
  routes dim, an animated “flow” line and numbered stop badges appear, and a
  truck marker animates along the road.

### 5.3 Editing a plan (manual overrides)

Click a route card to expand its **stop list**, then:

- **Reorder stops** — drag a stop up or down. The route re-computes distance,
  duration, ETA, and cost, and re-snaps to roads.
- **Reassign a stop** — use the **Move to…** dropdown on a stop to send it to
  another truck. Both routes re-compute. (Over-capacity is allowed but the
  utilization % turns red to flag it.)
- **Lock a route** — click **Lock**. A locked route keeps its stops and its
  truck/round slot the next time you run **Auto Route** — only the rest of the
  network is re-optimized. Click **Unlock** to release it.

### 5.4 What-if & savings

- **Fleet — what-if** (expandable panel): untick any truck to **exclude** it from
  the next Auto Route — useful for “what if this truck is in for service?”.
- After any re-plan, a **Savings vs previous plan** banner shows the change in
  cost, distance, and CO₂ (green = reduced).

### 5.5 Multi-day planning

Locations can carry a **delivery-day schedule** (which weekdays they need
service — set in Delivery Locations; empty = every day). In the Planner, the
**Plan day** panel lets you:

- pick a weekday (or **Every day**) — **Auto Route** then plans only the stops
  scheduled for that day, and
- see a **Weekly demand** overview (stops and m³ per weekday) to balance the
  week at a glance.

### 5.5 Export

- **Export Excel** — the full plan (routes, stops, costs, master data) as a
  styled multi-sheet workbook.

---

## 6. Operations (Trip Execution)

For running the plan on the day.

- **Trip status workflow:** Planned → **Dispatch** → **Start** (in transit) →
  **Complete** (with **Reopen** to revert). Status is shown as a badge.
- **Departure time:** set each route’s planned departure clock; planned arrival
  times per stop are computed from it.
- **Proof of Delivery (POD):** click **Record delivery** on a stop to capture
  status (delivered / failed / pending), **actual arrival time**, receiver name,
  a note, and a **photo**. A progress bar tracks delivered stops.
- **ETA / delay:** once an arrival time is recorded, each stop shows a delay
  badge — **On time**, **Late N min**, or **Early N min** — versus the planned
  ETA.
- **Route Sheet:** click to open a **printable driver sheet** for one route
  (stops, ETAs, windows, demand, signature lines).
- **Dispatch Manifest:** the header button prints a one-page manifest of the
  whole plan ([§10](#10-printed-documents)).

---

## 7. Incident Log

Record operational exceptions: date, **type** (breakdown / delay / accident /
damage / other), **severity** (low / medium / high), affected truck, description,
and a **Resolved** flag. High-severity open incidents raise an alert. Export to
CSV.

---

## 8. Cost Summary

A pivot of the current plan’s cost, grouped **By Partner / By Truck / By Route**.
Shows fixed vs. variable cost, THB per m³, the **daily total**, and a **×22-day
monthly estimate**. Export to Excel.

---

## 9. Billing & Payments

Turn a plan into invoices.

- **Create Billing from Plan** — generates one billing record **per transport
  partner**, applying that partner’s **rate card** (THB/km and/or THB/trip),
  **minimum charge**, and **credit-day** due date.
- Each invoice carries **VAT 7%** and **withholding tax 1%** (the Thai rate for
  transport services). **Net payable = (subtotal + fuel surcharge) + VAT − WHT.**
- **Workflow:** Draft → **Approve** → **Mark Paid** (records the paid date).
- **Edit** an invoice to adjust invoice number, fuel surcharge %, or notes — a
  live preview recalculates the totals.
- **KPI tiles:** Total Billed, Outstanding, **Overdue** (red), Paid This Month.
- **Export Excel** — a billing register with the full tax breakdown.
- **Bank Payment File** — export a bank bulk-transfer CSV of all outstanding
  invoices, grouped by partner, using each partner’s **bank details** (set in
  Transport Partners). Columns: recipient name, bank, account no., amount,
  reference (invoice numbers), and payment date.

Document buttons on this page are covered next.

---

## 10. Printed Documents

All documents open in a print window with a **“Print / Save as PDF”** button.
This route renders Thai text perfectly and, when saved, produces a real PDF. Set
your company header in **Settings → Company** first.

| Document | Where | Contents |
|----------|-------|----------|
| **Tax Invoice** (ใบกำกับภาษี) | Printer icon on each Billing row | Company letterhead + Tax ID, Bill-To, line items, VAT/WHT, net payable, and **amount in words** (Thai or English) |
| **Monthly Statement** | “Monthly Statement” on Billing header → pick partner + month | All invoices for that partner/month, totals, and outstanding balance |
| **Dispatch Manifest** | “Dispatch Manifest” on Operations header | All routes with truck, driver, partner, stops, m³/kg/km, status, and totals |
| **Route Sheet** | “Route Sheet” per route on Operations | Per-truck driver sheet with stop sequence, ETAs, and signature lines |

Dates on documents follow the selected language — Buddhist era (e.g. 2569) in
Thai, Gregorian in English.

---

## 11. Visual Truck 3D & Products

The **Products** master (see [§4.5](#45-products)) defines cargo items with
physical dimensions and weight per supplier.

**Visual Truck 3D** provides an interactive 3D view of how cargo loads into a
truck body, helping visualize space utilization for a route. Select a truck/route
to see the load arrangement. (This complements the numeric m³/kg utilization
shown on route cards.)

---

## 12. Dashboard & Alerts

**Dashboard** — KPI tiles (active locations, trucks, planned routes, total
distance, daily cost, **total CO₂**, average utilization) plus bar charts for
per-route utilization and cost by partner.

**Alert Center** (bell in the sidebar) — a live badge and dropdown listing:

- overdue invoices,
- unassigned stops in the plan,
- open / high-severity incidents,
- failed deliveries,
- trips in progress,
- drivers without an assigned truck.

Click any alert to navigate to the relevant page.

---

## 13. Settings

- **Language** — English / ไทย (also on the sidebar).
- **Mapbox Access Token** — required to display the map.
- **Depot (Route Origin)** — name and coordinates; the planning start/end point.
- **Average Speed** and **Snap routes to real roads** toggle.
- **Appearance** — **Light / Dark** theme (also toggled by the sun/moon icon at
  the bottom of the sidebar). The choice is saved to the database.
- **Access Role** — **Admin / Dispatcher / Viewer** (see [§13.1](#131-roles--access-control)).
- **Fuel & Emissions** — diesel price (THB/L), fuel economy (km/L), and CO₂ per
  litre. **Apply fuel price to all trucks’ cost/km** recomputes each truck’s
  cost from the current fuel price.
- **Company (for documents)** — company name, Tax ID, and address printed on
  invoices, statements, and manifests.
- **Activity Log** — a change history of who did what, when (see below).
- **Data Management** (admin only) — **Reset to Sample Data** or **Clear All
  Data**.

### 13.1 Sign in, roles & access control

The app requires a **login**. Each user has a role, and the role is enforced by
the server (not just hidden in the UI):

| Role | Can do |
|------|--------|
| **Admin** | Everything, including settings, data management, and reset |
| **Dispatcher** | Plan routes, run operations, and create billing — but not edit master data or system settings |
| **Viewer** | Read-only — no create/edit/delete anywhere (server rejects writes); exports still allowed |

Default accounts are created on first run — **change these**: `admin/admin`,
`dispatcher/dispatcher`, `viewer/viewer` (override with `ADMIN_PASSWORD` etc.).
Sessions use an httpOnly cookie; **Settings → Log out** ends the session. When a
role lacks a capability, its buttons (Add, Import, Auto Route, edit/delete) are
hidden, and the API rejects the action if attempted directly.

### 13.2 User management (admin only)

Admins get a **Users** page (Administration section of the sidebar) to **add**
users (username, role, password), **change** a user's role or reset their
password, and **delete** users. Safeguards prevent deleting your own account or
removing the last admin. Passwords are stored scrypt-hashed; the plaintext is
never shown or returned.

### 13.3 Activity Log

Every create / update / delete of master data, every billing action, and every
settings change is recorded with a timestamp and the acting role. The **Activity
Log** in Settings shows the most recent entries; the full log is persisted in the
database.

### 13.4 CSV import

**Delivery Locations** supports **Import CSV** (admin/dispatcher). Use the same
column headers as the CSV export (`Code, Name, NameTH, Kind, Zone, Lat, Lng,
DemandM3, DemandKg, ServiceMin, WindowStart, WindowEnd, Active`). Rows whose
`Code` matches an existing location **update** it; others are **created**.
Coordinates are validated and invalid rows are skipped.

---

## 14. Data & Persistence (Neon Postgres)

State is stored in **Neon Postgres**, not the browser.

- A small Express API (`server/index.mjs`) owns the `DATABASE_URL` and serves
  `GET /api/state` (load everything), `PUT /api/state` (save everything), and
  `POST /api/seed` (re-seed).
- The canonical dataset lives in **`server/seed.mjs`**; the server inserts it
  into Neon on first run. The browser store starts **empty** and loads real
  records from the database — no mock data ships in the client.
- The frontend hydrates from the API on startup and **auto-saves** (debounced)
  on every change. Saves are serialized so concurrent writes never collide.
- **Reset to Sample Data** (Settings) calls `POST /api/seed`, which re-seeds the
  database, then reloads.
- Tables: `partners`, `trucks`, `drivers`, `locations`, `products`, `billings`,
  `pods`, `incidents` (each `id`, `doc jsonb`) plus a `singletons` table for
  `settings` and `plan`.

Because everything is in the database, opening the app on another machine (with
the same `DATABASE_URL`) shows the same data.

---

## 15. Import / Export

- **Excel export** — Route Planner, Cost Summary, and Billing pages produce
  styled `.xlsx` workbooks (localised to the current language).
- **CSV export** — Delivery Locations, Drivers, and Incident Log.
- All exports respect the current language and number formatting.

---

## 16. Troubleshooting & FAQ

**The map is blank.** Add a Mapbox token in **Settings**, then hard-refresh
(Cmd/Ctrl+Shift+R). Without a token, planning still works using straight-line
road estimates.

**Routes are straight lines / distances look off.** Ensure a Mapbox token is set
and **Snap routes to real roads** is on, then run **Auto Route** again. Existing
plans self-upgrade to real roads when the Planner opens with a working token.

**Data didn’t save.** Confirm the API server is running (`npm run server`) and
that `DATABASE_URL` is correct — check `http://localhost:3001/api/health` returns
`{"ok":true}`.

**A stop won’t fit any truck.** It appears under **Unassigned Stops** — add a
truck, add rounds, or increase a truck’s capacity.

**Thai text is garbled in a document.** Use the **Print / Save as PDF** button in
the document window (it uses the browser’s Thai font); avoid third-party PDF
tools that don’t embed Thai fonts.

---

## 17. Glossary

| Term | Meaning |
|------|---------|
| **Milkrun** | A fixed loop collecting/delivering between a depot and multiple stops |
| **CVRP** | Capacity-Constrained Vehicle Routing Problem — the optimizer’s model |
| **Round** | One trip of a truck in a day; a truck may run several rounds |
| **m³ / kg utilization** | How full a truck is by volume / weight (100% = full) |
| **POD** | Proof of Delivery — arrival time, receiver, note, photo |
| **VAT (ภาษีมูลค่าเพิ่ม)** | Value Added Tax, 7% in Thailand |
| **WHT (หัก ณ ที่จ่าย)** | Withholding tax, 1% for transport services |
| **Net Payable (ยอดชำระสุทธิ)** | (subtotal + fuel surcharge) + VAT − WHT |
| **Depot (ศูนย์กระจายสินค้า)** | The origin/return point for all routes |
| **Locked route** | A route excluded from re-optimization |

---

*© TMS Milkrun. Sample company data (AISIN Thailand) is illustrative.*
