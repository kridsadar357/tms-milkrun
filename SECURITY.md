# Security Assessment & Test Report — TMS Milkrun

Authorized assessment of the running application (client + API + Neon Postgres).
Scope: `http://localhost:5173` (SPA) and `http://localhost:3001/api` (Express API).

---

## 1. End-to-end functional test

Automated browser drive of the full business process — **14/14 checks passed**:

| Area | Check | Result |
|------|-------|--------|
| Load | App renders, sidebar present | ✅ |
| Data | Neon seeded (12 locations, 3 partners, 4 trucks, 4 drivers, 13 products) | ✅ |
| Master data | Add location persists to Neon | ✅ |
| Planner | Auto Route produces road-snapped routes | ✅ |
| Planner | Routes respect truck capacity | ✅ |
| Operations | POD recorded and persisted | ✅ |
| Incidents | Incident logged | ✅ |
| Billing | Created from plan with VAT 7% / WHT 1% | ✅ |
| Documents | Tax invoice renders | ✅ |
| Finance | Bank payment batch exports | ✅ |
| Audit | Actions recorded in Neon | ✅ |
| UX | Dark mode toggles | ✅ |
| Roles | Viewer is read-only (Add/Import hidden) | ✅ |
| Stability | No uncaught console/page errors | ✅ |

**Reliability bugs found & fixed during testing**
- Concurrent full-state `PUT` + reseed caused DB transaction collisions (HTTP 500,
  occasional lost writes) → **server-side write lock** serializes all writes.
- A pending client save could land after a reseed and clobber it → **`drainSaves()`**
  flushes/cancels pending saves before reset.
- Audit log didn't record incidents → **incidents now audited**.

---

## 2. Penetration test — findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **No authentication** — any client reaching the API could read/write all data | High | **Fixed** — login + httpOnly session cookie; all data endpoints require a valid session |
| 2 | Unauthenticated `POST /api/seed` wipes + reseeds the DB | High | **Fixed** — admin-only + rate-limited; `DISABLE_RESET=true` fully disables it |
| 3 | Permissive CORS (`Access-Control-Allow-Origin: *`) | Medium | **Fixed** — disabled in production; allow-list via `ALLOWED_ORIGINS` |
| 4 | Error/stack disclosure (malformed JSON returned Express stack) | Medium | **Fixed** — generic `{"error":"invalid JSON"}`; no `String(e)` leaks |
| 5 | No rate limiting on writes | Medium | **Fixed** — 120 writes/min/IP → 429 |
| 6 | A stuck/aborted write could wedge the server (no query timeout) | Medium | **Fixed** — `statement_timeout` / `query_timeout` / connect timeout |
| 7 | Missing security headers | Low | **Fixed** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| 8 | `X-Powered-By: Express` fingerprinting | Low | **Fixed** — disabled |

**Tested and NOT vulnerable**

| Test | Result |
|------|--------|
| SQL injection (malicious ids/payloads) | Safe — parameterized queries; fixed table names |
| Stored XSS (`<img onerror>` / `<script>` in a location name) | Safe — rendered inert; React escaping + `esc()` in all HTML builders |
| DB credentials in client bundle | Absent — `DATABASE_URL` is server-only (only the public Mapbox `pk.` token ships) |
| Oversized payload | Mitigated — 8 MB body limit → 413 |
| Prototype pollution (`__proto__` in JSON) | Not exploitable — data stored/returned as JSONB, not merged into prototypes |
| Undefined HTTP methods | Rejected (404) |

**Authentication (implemented).** Login (`POST /api/login`) verifies a
scrypt-hashed password and issues an **HMAC-signed session token in an httpOnly,
SameSite=Lax cookie** (`Secure` in production). Every data endpoint requires a
valid session: `GET /api/state` needs any role; `PUT /api/state` requires
**admin/dispatcher** (viewer is server-enforced read-only); `POST /api/seed` is
**admin-only** and can be disabled with `DISABLE_RESET=true`. Roles now come from
the authenticated user, not a client toggle. Default accounts are seeded once
(`admin/admin`, `dispatcher/dispatcher`, `viewer/viewer`) — **change these** via
`ADMIN_PASSWORD` / `DISPATCHER_PASSWORD` / `VIEWER_PASSWORD`, and set a strong
`AUTH_SECRET` in production.

Verified: unauthenticated request → 401; viewer write → 403; viewer seed → 403;
wrong password → 401; session cookie is httpOnly.

Residual note: `PUT /api/state` replaces the whole document set, so the finer
dispatcher-vs-admin master-data distinction is still enforced client-side; the
critical **viewer = read-only** boundary is enforced on the server.

**Hardening env vars**
- `ALLOWED_ORIGINS` — comma-separated allow-list (else CORS off in production).
- `NODE_ENV=production` — disables permissive CORS and serves the built app.

---

## 3. Manual test checklist

Run through this by hand after any significant change. Depot origin is AISIN
Amata City Chonburi; a Mapbox token (Settings or `.env`) is needed for the map.

### Setup
- [ ] `npm run dev` starts API (:3001) and web (:5173); `/api/health` → `{"ok":true}`.
- [ ] First load shows seeded data (12 locations, 3 partners, 4 trucks, 4 drivers, 13 products).

### Master data
- [ ] Add / edit / delete a **location**; invalid lat/long is blocked; outside-Thailand warns.
- [ ] Zone filter and search work; CSV export downloads; **CSV import** adds/updates rows.
- [ ] Add / edit a **truck** (capacity presets), **driver** (assign truck), **partner** (rate card + bank).

### Planner
- [ ] **Auto Route** produces routes; map renders; routes snap to roads.
- [ ] Utilization %, CO₂, distance, cost show per route.
- [ ] Select a route → fly-to, numbered stops, animated truck; **drag to reorder** recomputes.
- [ ] **Move to…** reassigns a stop; **Lock** survives re-plan; **Fleet what-if** excludes a truck; **savings** banner appears.
- [ ] **Plan day** filters stops by weekday; weekly demand overview varies by day.

### Operations
- [ ] Trip status Dispatch → Start → Complete → Reopen.
- [ ] Set departure time; **Record delivery** (status, arrival, receiver, photo) → delay badge shows.
- [ ] **Route Sheet** and **Dispatch Manifest** print (Thai renders).

### Finance & documents
- [ ] **Create Billing from Plan** → one invoice per partner; VAT 7% / WHT 1% correct.
- [ ] Approve → Mark Paid; overdue KPI turns red.
- [ ] **Invoice PDF**, **Monthly Statement**, **Bank Payment File** all produce correct output.

### System
- [ ] Language EN/ไทย toggles everywhere; Buddhist-era dates on Thai documents.
- [ ] **Dark mode** toggles and persists.
- [ ] **Roles**: Viewer hides create/edit; Dispatcher can plan/bill but not edit master data; Admin full.
- [ ] **Activity Log** records changes; **Reset to Sample Data** re-seeds cleanly.
- [ ] Reload the page → all data returns from Neon (nothing lost).

### Security spot-checks
- [ ] Malformed API request returns a generic error (no stack).
- [ ] `<script>` typed into a name renders as text, never executes.
- [ ] Response headers include `X-Frame-Options` / `X-Content-Type-Options`; no `X-Powered-By`.
