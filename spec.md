# FoggleBet — Product Spec

## Overview
A personal +EV bet tracking tool. A Chrome extension overlays a button on picktheodds.com — clicking it captures bet data and logs it to a deployed dashboard. The app then automatically fetches closing odds and game results so every bet can be evaluated for Closing Line Value (CLV) and actual P&L.

---

## 1. Data Model

### Bet Record

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Auto-generated primary key |
| `recorded_at` | timestamp | When the bet was logged (UTC) |
| `game_time` | timestamp | Scheduled start time of the game (UTC) — used to trigger closing odds fetch |
| `bet_name` | string | Description of the bet (e.g. "Lakers ML") |
| `sport` | string | Sport category (e.g. "NBA", "NFL") |
| `market` | string | Bet market type (e.g. "Moneyline", "Spread", "Total") |
| `line` | string | The line being bet (e.g. "-3.5", "Over 224.5") |
| `ev_percent` | number | EV% shown on picktheodds at time of capture |
| `best_book` | string | Sportsbook with best odds at capture time |
| `best_odds` | number | Best odds at capture time (American format) |
| `book_odds` | json | All sportsbook odds at capture time `{"DraftKings": -108, ...}` |
| `closing_odds` | json | Closing odds per sportsbook — populated automatically before game start |
| `clv` | number | Closing Line Value: difference between your odds and closing line |
| `result` | enum | `pending` → `win` / `loss` / `push` — populated automatically after game |
| `profit_loss` | number | Actual P&L in units — calculated from result + odds |
| `stake` | number | Units staked (entered manually or defaulted to 1) |
| `source_url` | string | picktheodds URL at time of capture |
| `notes` | string | Optional manual notes |

> **TBD:** Exact scraped fields depend on picktheodds DOM inspection. Confirm `game_time`, `sport`, `market` availability before building scraper.

---

## 2. Chrome Extension

### Behavior
- Runs only on `https://picktheodds.com/*`
- Injects a **"Log Bet"** button on each bet row in the odds table
- On click:
  1. Reads bet data from that row's DOM
  2. Captures timestamp
  3. POSTs payload to the web app API
  4. Shows green confirmation flash on success
  5. Shows red error indicator on failure — never fails silently

### Auth
- Static API key stored in `chrome.storage.local` (not hardcoded in content script)

### Out of Scope
- Editing/deleting bets from the extension
- Any UI beyond the per-row button and status indicator

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
- Total bets, win rate, ROI, average EV%, average CLV
- CLV distribution chart (are you consistently beating the close?)
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
