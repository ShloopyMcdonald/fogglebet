# FoggleBet — Product Spec

## Overview
A personal +EV bet tracking tool. The bets on picktheodds are displayed as arbitrage opportunities (two sides across different books). The user doesn't take both sides — they identify and bet the sharper side only. FoggleBet logs **both sides of every arb** as separate linked records so the user can track their side-picking accuracy over time (i.e. does the side I choose consistently have better CLV than the side I pass on?).

A Chrome extension overlays a button on picktheodds.com — one click captures both sides of the arb and logs them to a deployed dashboard. The app automatically fetches closing odds and game results so every bet can be evaluated for CLV and actual P&L.

---

## 1. Data Model

### Bet Record

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Auto-generated primary key |
| `arb_id` | uuid | Links both sides of the same arb together |
| `is_taken` | boolean | `true` = side the user actually bet, `false` = side passed on |
| `recorded_at` | timestamp | When the arb was logged (UTC) |
| `game_time` | timestamp | Scheduled start time of the game (UTC) — used to trigger closing odds fetch |
| `bet_name` | string | Description of this side (e.g. "Lakers ML") |
| `sport` | string | Sport category (e.g. "NBA", "NFL") |
| `market` | string | Bet market type (e.g. "Moneyline", "Spread", "Total") |
| `line` | string | The line being bet (e.g. "-3.5", "Over 224.5") |
| `book` | string | Sportsbook or exchange for this side (e.g. "DraftKings", "Novig") |
| `odds` | number | Odds for this side at capture time (American format) |
| `liquidity` | number | Available liquidity in dollars — only populated for exchanges (Novig, ProphetX, Polymarket), null for sportsbooks |
| `ev_percent` | number | EV% shown on picktheodds at time of capture |
| `arb_percent` | number | Arb % shown on picktheodds (guaranteed profit if both sides taken) |
| `closing_odds` | number | Closing odds for this side — populated automatically before game start |
| `clv` | number | Closing Line Value for this side (positive = beat the close) |
| `result` | enum | `pending` → `win` / `loss` / `push` — populated automatically after game |
| `profit_loss` | number | P&L in units — only meaningful when `is_taken = true` |
| `stake` | number | Units staked — only relevant when `is_taken = true`, defaults to 1 |
| `source_url` | string | picktheodds URL at time of capture |
| `notes` | string | Optional manual notes |

> **TBD:** Exact scraped fields depend on picktheodds DOM inspection. Confirm `game_time`, `sport`, `market`, `arb_percent`, and `liquidity` (for exchange rows) availability before building scraper. Liquidity is displayed on picktheodds for exchanges (Novig, ProphetX, Polymarket) — verify the selector.

---

## 2. Chrome Extension

### Behavior
- Runs only on `https://picktheodds.com/*`
- Injects a **"Log Arb"** button on each arb row in the odds table
- On click:
  1. Reads both sides of the arb from that row's DOM
  2. Prompts: **"Which side are you taking?"** — shows side A (book + odds) vs side B (book + odds)
  3. User selects their side — the other is automatically marked `is_taken = false`
  4. Generates a shared `arb_id` and POSTs both sides to the API
  5. Shows green confirmation flash on success
  6. Shows red error indicator on failure — never fails silently

### Auth
- Static API key stored in `chrome.storage.local` (not hardcoded in content script)

### Out of Scope
- Editing/deleting bets from the extension
- Any UI beyond the per-row button, side-selection prompt, and status indicator

---

## 3. Automated Data Enrichment

This is the core intelligence layer — runs without user interaction.

### Data Source: Action Network
- `https://www.actionnetwork.com` — public site, no API key required
- Provides closing odds, live odds, and game results for all major sports
- Scraped using `fetch` + `cheerio` (lightweight HTML parsing — no browser required)
- Action Network renders key data server-side, making it cheerio-compatible

> **TBD:** Confirm Action Network page structure during DOM inspection step. Verify closing odds and scores are in the HTML (not loaded via client-side JS). If JS-rendered, switch to `playwright` on a lightweight scraping worker.

### 3a. Closing Odds (Vercel Cron Job)
- **Trigger:** Runs every 15 minutes
- **Logic:** Finds all bets where `result = 'pending'` and `game_time` is within 30 minutes or has just passed
- **Action:** Scrapes Action Network odds page for the matching event, extracts closing odds per book, writes to `closing_odds`, calculates and stores `clv`
- **CLV formula:** `clv = implied_prob(closing_odds) - implied_prob(best_odds)` (positive = you beat the close)
- **Matching:** Match logged bet to Action Network event by sport + team names + game time

### 3b. Results (Vercel Cron Job)
- **Trigger:** Runs every 30 minutes
- **Logic:** Finds all bets where `result = 'pending'` and `game_time` has passed by 3+ hours
- **Action:** Scrapes Action Network scores/results page for the matching event, determines win/loss/push, writes `result`, calculates `profit_loss`
- **P&L formula:** Win = `stake * (odds > 0 ? odds/100 : 100/Math.abs(odds))`, Loss = `-stake`, Push = `0`

---

## 4. Web App — Dashboard

### Pages

#### `/` — Bet Feed
- Chronological list of all bets, newest first
- Columns: time, bet name, sport, market, odds logged, EV%, best book, closing odds, CLV, result, P&L
- Color coded: green = win/positive CLV, red = loss/negative CLV, grey = pending
- Click row to expand: see all book odds at capture + closing odds side by side
- Filters: sport, market, date range, result, sportsbook

#### `/stats` — Performance Dashboard
- Total arbs logged, win rate, ROI, average EV%, average CLV
- **Side-picking accuracy** — when you choose side A over side B, does your side have higher CLV? (core insight)
- CLV distribution: your side vs passed side (are you consistently picking the sharper leg?)
- P&L over time chart
- Breakdown by sport, market, sportsbook

### Design
- Dark mode, clean and modern
- Subtle background gradient or pattern (not flat black)
- Desktop-primary, mobile-readable
- No auth — personal use, deployed URL kept private
- Specific layouts, colors, and component details to be decided iteratively once the app is running

---

## 5. API Routes

### `POST /api/bets`
Receives bet from Chrome extension.

**Request body:**
```json
{
  "bet_name": "Lakers ML",
  "sport": "NBA",
  "market": "Moneyline",
  "line": null,
  "ev_percent": 4.2,
  "best_book": "DraftKings",
  "best_odds": -108,
  "book_odds": { "DraftKings": -108, "FanDuel": -112, "BetMGM": -115 },
  "game_time": "2026-03-25T19:30:00Z",
  "source_url": "https://picktheodds.com/..."
}
```

**Headers:** `x-api-key: <static key>`

**Responses:** `201` created / `400` bad request / `401` unauthorized / `500` error

### `GET /api/bets`
Returns bets for dashboard. Internal only.

### `POST /api/cron/closing-odds`
Called by Vercel Cron — fetches and stores closing odds + CLV for pending bets.

### `POST /api/cron/results`
Called by Vercel Cron — fetches game results and updates bet outcomes.

---

## 6. Build Order

### Phase 1 — Core (MVP)
1. Inspect picktheodds DOM → confirm scrapable fields
2. Set up Supabase project + `bets` table
3. Scaffold Next.js web app + deploy to Vercel
4. Build `POST /api/bets` endpoint
5. Scaffold Chrome extension (Manifest V3)
6. Build content script: overlay button + DOM scraper
7. Wire extension → API
8. Build dashboard feed UI (`/`)
9. End-to-end test: log a bet → verify it appears in dashboard

### Phase 2 — Automation
10. Inspect Action Network DOM → map closing odds + scores page structure
11. Build Action Network scraper (`fetch` + `cheerio`)
12. Build closing odds cron job
13. Build results cron job
14. Verify CLV + result auto-population end-to-end

### Phase 3 — Analytics
15. Build `/stats` performance dashboard
16. Add charts (CLV distribution, P&L over time)
