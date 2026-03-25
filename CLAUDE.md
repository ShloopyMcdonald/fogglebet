# CLAUDE.md — FoggleBet North Star

## Purpose
FoggleBet is a personal +EV sports betting tracker. A Chrome extension overlays a button on picktheodds.com — clicking it captures bet data and sends it to a deployed dashboard. The app automatically fetches closing odds and game results from Action Network so every bet can be evaluated for Closing Line Value (CLV) and actual P&L.

This is a solo-use, production-grade tool. Speed and reliability matter more than scalability.

**Full product spec:** see `spec.md`

## Stack
- **Chrome Extension**: Manifest V3 — content script injects overlay onto picktheodds.com
- **Web App**: Next.js (App Router) + Tailwind CSS — bet tracking dashboard
- **Database**: Supabase (Postgres) — stores all recorded bets
- **Scraping**: `fetch` + `cheerio` — scrapes Action Network for closing odds and results
- **Cron Jobs**: Vercel Cron — automates closing odds + result population
- **Deployment**: Vercel (web app), Chrome Web Store or local unpacked (extension)
- **Language**: TypeScript throughout

## Repo Map
```
fogglebet/
├── extension/                  # Chrome MV3 extension
│   ├── manifest.json
│   ├── content/                # Content scripts (DOM scraping, overlay injection)
│   ├── background/             # Service worker
│   └── popup/                  # Extension popup UI (if needed)
├── web/                        # Next.js dashboard app
│   ├── app/
│   │   ├── api/
│   │   │   ├── bets/           # POST (from extension), GET (dashboard)
│   │   │   └── cron/
│   │   │       ├── closing-odds/   # Scrapes Action Network closing odds
│   │   │       └── results/        # Scrapes Action Network game results
│   │   └── (pages)/            # Dashboard UI pages
│   ├── components/             # UI components
│   ├── lib/
│   │   ├── supabase.ts         # Supabase client
│   │   └── scraper.ts          # Action Network scraping logic
│   └── supabase/
│       └── migrations/         # All schema changes go here
├── tasks/
│   ├── todo.md                 # Active task list
│   └── lessons.md              # Permanent lessons from bugs/corrections
├── spec.md                     # Full product spec
└── CLAUDE.md
```

## Rules

### General
- Always enter plan mode for any task involving more than 3 steps
- Never mark a task done without verifying it works end-to-end
- After any user correction, add a permanent lesson to `tasks/lessons.md`
- Review `tasks/lessons.md` at the start of every session
- Keep solutions simple — no over-engineering for a solo-use tool
- No `any` types in TypeScript

### Extension
- Target host: `https://picktheodds.com/*`
- DOM scraping must be resilient — picktheodds may update markup; use stable selectors and log warnings when selectors fail
- Never block the main thread in content scripts
- All data sent to the web app via authenticated POST — never write to Supabase directly from the extension
- API key stored in `chrome.storage.local`, never hardcoded

### Web App
- Use Next.js App Router and server components by default
- Use Tailwind for all styling — no external component libraries unless absolutely necessary
- Keep the dashboard fast and readable — utility tool, not a showcase

### Scraping
- Use `fetch` + `cheerio` for Action Network — no Puppeteer unless server-side rendering is confirmed unavailable
- Scraper logic lives in `web/lib/scraper.ts`
- Cron jobs must never crash silently — log failures and leave bet in `pending` state if scrape fails

### Data
- Every recorded bet must include: bet name, line, odds per sportsbook, timestamp, source URL, and game time
- `closing_odds`, `clv`, and `result` are populated automatically by cron jobs — never set manually
- Supabase schema changes require a migration file in `web/supabase/migrations/`

## Task Management
- Track active work in `tasks/todo.md`
- Log permanent lessons (bugs, corrections, decisions) in `tasks/lessons.md`
- Use plan mode before starting any non-trivial feature

## Commands
- `npm run dev` — start Next.js dev server (from `/web`)
- Load `/extension` as unpacked extension in Chrome for local testing
- `supabase db push` — apply migrations
