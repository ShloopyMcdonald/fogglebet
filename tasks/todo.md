# FoggleBet — Active Tasks

## In Progress
_nothing_

## Backlog

### Manual step needed
- [ ] Run migration in Supabase dashboard SQL editor
  - File: `web/supabase/migrations/001_create_bets.sql`
  - Go to: supabase.com → project → SQL Editor → paste + run

### Next: Deploy
- [ ] Connect GitHub repo to Vercel (vercel.com → new project → import fogglebet)
- [ ] Set env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `API_KEY`
- [ ] Trigger deploy, verify it loads
- [ ] Update extension popup: set API URL to Vercel deployment URL, API key to match `API_KEY`
- [ ] Load extension unpacked in Chrome, test log on picktheodds

### Remaining Phase 1 work
- [ ] End-to-end test: log a bet → verify it appears in dashboard
- [ ] Find liquidity selector (Novig/ProphetX rows) — see tasks/dom-map.md TBD section

## Done
- [x] Inspect picktheodds DOM → stable selectors confirmed, dom-map.md written
- [x] Scaffold Next.js app (`web/`)
- [x] Install @supabase/supabase-js
- [x] Create `.env.local`
- [x] Create Supabase migration SQL (`web/supabase/migrations/001_create_bets.sql`)
- [x] Create `web/lib/supabase.ts`
- [x] Build `POST /api/bets` endpoint
- [x] Build `GET /api/bets` endpoint
- [x] Scaffold Chrome extension (manifest, background, popup)
- [x] Build content script (scraper + Log Arb button + side-picker modal)
- [x] Build dashboard feed UI (`web/app/page.tsx`)
