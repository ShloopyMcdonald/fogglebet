import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import { parseTeamsFromBetName } from '@/lib/espn'
import {
  ODDS_API_SPORT_SLUGS,
  ODDS_API_LEAGUE_SLUGS,
  SHARP_BOOK_PRIORITY,
  PROP_BOOK_PRIORITY,
  fetchEvents,
  fetchEventOddsById,
  findEvent,
  findClosingOdds,
  calcCLV,
  OddsApiEvent,
  OddsApiOddsResponse,
} from '@/lib/odds-api'

export async function GET(req: NextRequest) {
  // Auth: Vercel or GitHub Actions sends Authorization: Bearer {CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.error('[closing-odds-cron] ODDS_API_KEY not set')
    return NextResponse.json({ error: 'ODDS_API_KEY not configured' }, { status: 500 })
  }

  const now = new Date()

  // Pre-game capture windows per sport (minutes before game start).
  // Fetch with the widest window, then filter per-bet below.
  // NBA/NHL: PTO game_time is ~10 min after actual scheduled start on odds-api.io.
  // odds-api.io transitions to "live" (bookmakers: {}) at the scheduled start, not PTO's time.
  // NBA: 25 min window → cron fires at game_time-25min = actual_start-15min → 15-min capture buffer.
  // NHL: 20 min window → 10-min buffer before actual start.
  // MLB: 5 min window (PTO game_time aligns closely with actual start).
  const SPORT_WINDOWS_MINUTES: Record<string, number> = {
    nba: 25,
    nhl: 20,
    mlb: 5,
  }
  const DEFAULT_WINDOW_MINUTES = 10
  const MAX_WINDOW_MINUTES = 25 // must equal the largest value above

  function preGameWindowMinutes(sport: string): number {
    const normalized = sport.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
    return SPORT_WINDOWS_MINUTES[normalized] ?? DEFAULT_WINDOW_MINUTES
  }

  // Retroactive window: 60 min behind game_time catches bets missed by delayed cron runs.
  // Forward window: per-sport pre-game cutoff (NBA/NHL: 12 min, MLB: 2 min, others: 5 min).
  // Without every-minute cron firing, a narrow retroactive window permanently misses games
  // that fall between cron fires.
  const RETROACTIVE_MINUTES = 60
  const windowStart = new Date(now.getTime() - RETROACTIVE_MINUTES * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + MAX_WINDOW_MINUTES * 60 * 1000).toISOString()

  const { data, error: fetchError } = await supabase
    .from('bets')
    .select('*')
    .is('closing_odds', null)
    .eq('clv_checked', false)
    .not('game_time', 'is', null)
    .gte('game_time', windowStart)
    .lte('game_time', windowEnd)

  if (fetchError) {
    console.error('[closing-odds-cron] DB fetch error:', fetchError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Filter: each bet must be within its sport's pre-game window (forward),
  // OR already past game start (retroactive catch for delayed cron runs).
  const bets = ((data ?? []) as Bet[]).filter(bet => {
    if (!bet.game_time || !bet.sport) return true
    const gameTime = new Date(bet.game_time)
    // Already started — include it (retroactive catch)
    if (gameTime <= now) return true
    // Not yet started — apply per-sport pre-game window
    const windowMs = preGameWindowMinutes(bet.sport) * 60 * 1000
    return gameTime <= new Date(now.getTime() + windowMs)
  })
  if (bets.length === 0) {
    return NextResponse.json({ captured: 0, total: 0 })
  }

  // Debug: log bet counts by sport
  const betsBySport: Record<string, number> = {}
  for (const b of bets) {
    const s = (b.sport ?? 'unknown').toLowerCase()
    betsBySport[s] = (betsBySport[s] ?? 0) + 1
  }
  console.log(`[closing-odds-cron] Found ${bets.length} bets in window:`, JSON.stringify(betsBySport))

  function normalizeSport(sport: string): string {
    return sport.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
  }
  function toSportSlug(sport: string): string | null {
    return ODDS_API_SPORT_SLUGS[normalizeSport(sport)] ?? null
  }
  function toLeagueSlug(sport: string): string | null {
    return ODDS_API_LEAGUE_SLUGS[normalizeSport(sport)] ?? null
  }

  // Time window for /events: cover ±2h around now to catch all games starting soon
  const eventsFrom = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const eventsTo = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()

  // Group all bets (featured + props) by "sportSlug|leagueSlug" so each unique
  // sport+league combo gets exactly one /events fetch.
  const bySlug = new Map<string, { sportSlug: string; leagueSlug: string | null; bets: Bet[] }>()
  for (const bet of bets) {
    if (!bet.sport || !bet.market) {
      console.warn(`[closing-odds-cron] Bet ${bet.id} missing sport="${bet.sport}" or market="${bet.market}" — marking definitive`)
      await supabase.from('bets').update({ clv_checked: true }).eq('id', bet.id)
      continue
    }
    const sportSlug = toSportSlug(bet.sport)
    if (!sportSlug) {
      console.warn(`[closing-odds-cron] No odds-api slug for sport: "${bet.sport}" (bet ${bet.id})`)
      await supabase.from('bets').update({ clv_checked: true }).eq('id', bet.id)
      continue
    }
    const leagueSlug = toLeagueSlug(bet.sport)
    const key = `${sportSlug}|${leagueSlug ?? ''}`
    const group = bySlug.get(key) ?? { sportSlug, leagueSlug, bets: [] }
    group.bets.push(bet)
    bySlug.set(key, group)
  }

  // Cache events per sport slug; cache full odds per event ID
  const eventsCache = new Map<string, OddsApiEvent[]>()
  const oddsCache = new Map<number, OddsApiOddsResponse>()

  let captured = 0
  // definitiveIds: cron ran and conclusively can't get odds — mark clv_checked so they show "n/a"
  // transientIds:  API errors — leave clv_checked false so they retry next run
  const definitiveIds: string[] = []
  const transientIds: string[] = []

  for (const [cacheKey, { sportSlug, leagueSlug, bets: slugBets }] of bySlug) {
    if (!eventsCache.has(cacheKey)) {
      try {
        const events = await fetchEvents(sportSlug, eventsFrom, eventsTo, apiKey, leagueSlug ?? undefined)
        eventsCache.set(cacheKey, events)
        const label = leagueSlug ? `${sportSlug}/${leagueSlug}` : sportSlug
        console.log(`[closing-odds-cron] Fetched ${events.length} events for ${label} (window: ${eventsFrom} → ${eventsTo})`)
        // Log all events for this sport so we can verify which games are visible
        for (const ev of events) {
          console.log(
            `[closing-odds-cron]   event id=${ev.id} "${ev.away} @ ${ev.home}" status=${ev.status} date=${ev.date}`
          )
        }
        if (events.length === 0) {
          console.warn(`[closing-odds-cron] WARNING: 0 events returned for ${label} — bets on this sport will all miss`)
        }
      } catch (err) {
        console.error(`[closing-odds-cron] fetchEvents failed for ${sportSlug}:`, err)
        for (const b of slugBets) transientIds.push(b.id)
        continue
      }
    }
    const events = eventsCache.get(cacheKey)!

    for (const bet of slugBets) {
      const isNba = (bet.sport ?? '').toLowerCase() === 'nba'
      if (isNba) {
        console.log(
          `[closing-odds-cron][NBA] bet ${bet.id}: market="${bet.market}" line="${bet.line}" game_time="${bet.game_time}" bet_name="${bet.bet_name}"`
        )
      }

      if (!bet.line) {
        console.warn(`[closing-odds-cron] No line on bet ${bet.id}`)
        definitiveIds.push(bet.id)
        continue
      }

      const teams = parseTeamsFromBetName(bet.bet_name)
      if (!teams) {
        console.warn(`[closing-odds-cron] Cannot parse teams from: "${bet.bet_name}"`)
        definitiveIds.push(bet.id)
        continue
      }

      const event = findEvent(events, teams[0], teams[1], bet.id)
      if (!event) {
        // findEvent already logged the full details
        definitiveIds.push(bet.id)
        continue
      }

      if (isNba) {
        console.log(`[closing-odds-cron][NBA] bet ${bet.id}: matched event id=${event.id} "${event.away} @ ${event.home}" status=${event.status}`)
      }

      // Fetch full odds for this event — cached so two bets on the same game share one call
      if (!oddsCache.has(event.id)) {
        try {
          const allBooks = [...new Set([...SHARP_BOOK_PRIORITY, ...PROP_BOOK_PRIORITY])]
          const oddsResp = await fetchEventOddsById(event.id, allBooks, apiKey)
          oddsCache.set(event.id, oddsResp)
          if (isNba) {
            const books = Object.keys(oddsResp.bookmakers)
            const marketNames = books.flatMap(b => (oddsResp.bookmakers[b] ?? []).map(m => m.name))
            const uniqueMarkets = [...new Set(marketNames)]
            console.log(`[closing-odds-cron][NBA] event ${event.id} bookmakers=[${books.join(',')}] markets=[${uniqueMarkets.join(',')}]`)
          }
        } catch (err) {
          console.error(`[closing-odds-cron] fetchEventOddsById failed for ${event.id}:`, err)
          transientIds.push(bet.id)
          continue
        }
      }
      const oddsResp = oddsCache.get(event.id)!

      const result = findClosingOdds(oddsResp, bet)
      if (!result) {
        if (isNba) {
          console.warn(`[closing-odds-cron][NBA] bet ${bet.id}: findClosingOdds returned null — marking definitive miss`)
        } else {
          console.warn(`[closing-odds-cron] No closing odds found for bet ${bet.id} — marking clv_checked`)
        }
        definitiveIds.push(bet.id)
        continue
      }

      const clv = calcCLV(bet.odds, result.price, result.opposingPrice)

      const { error: updateError } = await supabase
        .from('bets')
        .update({
          closing_odds: result.price,
          closing_book: result.bookKey,
          closing_odds_raw: { book: result.bookKey, market: bet.market, entry: result.rawEntry },
          closing_odds_recorded_at: now.toISOString(),
          clv,
          clv_checked: true,
        })
        .eq('id', bet.id)

      if (updateError) {
        console.error(`[closing-odds-cron] Update failed for bet ${bet.id}:`, updateError)
        transientIds.push(bet.id)
      } else {
        console.log(
          `[closing-odds-cron] Captured closing odds for bet ${bet.id}: ` +
          `${result.price} (via ${result.bookKey}), CLV: ${clv.toFixed(2)}%`
        )
        captured++
      }
    }
  }

  // Batch-mark definitive failures as checked so dashboard shows "n/a" not "—"
  if (definitiveIds.length > 0) {
    await supabase.from('bets').update({ clv_checked: true }).in('id', definitiveIds)
  }

  return NextResponse.json({
    captured,
    total: bets.length,
    ...(definitiveIds.length > 0 && { definitive_misses: definitiveIds }),
    ...(transientIds.length > 0 && { transient_errors: transientIds }),
  })
}
