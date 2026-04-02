import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import { parseTeamsFromBetName } from '@/lib/espn'
import {
  ODDS_API_SPORT_SLUGS,
  SHARP_BOOK_PRIORITY,
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
  const windowStart = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 10 * 60 * 1000).toISOString()

  const { data, error: fetchError } = await supabase
    .from('bets')
    .select('*')
    .is('closing_odds', null)
    .not('game_time', 'is', null)
    .gte('game_time', windowStart)
    .lte('game_time', windowEnd)

  if (fetchError) {
    console.error('[closing-odds-cron] DB fetch error:', fetchError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const bets = (data ?? []) as Bet[]
  if (bets.length === 0) {
    return NextResponse.json({ captured: 0, total: 0 })
  }

  console.log(`[closing-odds-cron] Found ${bets.length} bets in window`)

  function toOddsSlug(sport: string): string | null {
    return ODDS_API_SPORT_SLUGS[sport.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()] ?? null
  }

  // Time window for /events: cover ±2h around now to catch all games starting soon
  const eventsFrom = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const eventsTo = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()

  // Group all bets (featured + props) by sport slug
  const bySlug = new Map<string, Bet[]>()
  for (const bet of bets) {
    if (!bet.sport || !bet.market) continue
    const slug = toOddsSlug(bet.sport)
    if (!slug) {
      console.warn(`[closing-odds-cron] No odds-api slug for sport: "${bet.sport}" (bet ${bet.id})`)
      await supabase.from('bets').update({ clv_checked: true }).eq('id', bet.id)
      continue
    }
    const group = bySlug.get(slug) ?? []
    group.push(bet)
    bySlug.set(slug, group)
  }

  // Cache events per sport slug; cache full odds per event ID
  const eventsCache = new Map<string, OddsApiEvent[]>()
  const oddsCache = new Map<number, OddsApiOddsResponse>()

  let captured = 0
  const failedIds: string[] = []

  for (const [slug, slugBets] of bySlug) {
    if (!eventsCache.has(slug)) {
      try {
        const events = await fetchEvents(slug, eventsFrom, eventsTo, apiKey)
        eventsCache.set(slug, events)
        console.log(`[closing-odds-cron] Fetched ${events.length} events for ${slug}`)
      } catch (err) {
        console.error(`[closing-odds-cron] fetchEvents failed for ${slug}:`, err)
        for (const b of slugBets) failedIds.push(b.id)
        continue
      }
    }
    const events = eventsCache.get(slug)!

    for (const bet of slugBets) {
      if (!bet.line) {
        console.warn(`[closing-odds-cron] No line on bet ${bet.id}`)
        failedIds.push(bet.id)
        continue
      }

      const teams = parseTeamsFromBetName(bet.bet_name)
      if (!teams) {
        console.warn(`[closing-odds-cron] Cannot parse teams from: "${bet.bet_name}"`)
        failedIds.push(bet.id)
        continue
      }

      const event = findEvent(events, teams[0], teams[1])
      if (!event) {
        console.warn(`[closing-odds-cron] No event match for "${bet.bet_name}"`)
        failedIds.push(bet.id)
        continue
      }

      // Fetch full odds for this event — cached so two bets on the same game share one call
      if (!oddsCache.has(event.id)) {
        try {
          const oddsResp = await fetchEventOddsById(event.id, SHARP_BOOK_PRIORITY, apiKey)
          oddsCache.set(event.id, oddsResp)
        } catch (err) {
          console.error(`[closing-odds-cron] fetchEventOddsById failed for ${event.id}:`, err)
          failedIds.push(bet.id)
          continue
        }
      }
      const oddsResp = oddsCache.get(event.id)!

      const result = findClosingOdds(oddsResp, bet)
      if (!result) {
        console.warn(`[closing-odds-cron] No closing odds found for bet ${bet.id} — marking clv_checked`)
        await supabase.from('bets').update({ clv_checked: true }).eq('id', bet.id)
        failedIds.push(bet.id)
        continue
      }

      const clv = calcCLV(bet.odds, result.price, result.opposingPrice)

      const { error: updateError } = await supabase
        .from('bets')
        .update({ closing_odds: result.price, closing_book: result.bookKey, clv, clv_checked: true })
        .eq('id', bet.id)

      if (updateError) {
        console.error(`[closing-odds-cron] Update failed for bet ${bet.id}:`, updateError)
        failedIds.push(bet.id)
      } else {
        console.log(
          `[closing-odds-cron] Captured closing odds for bet ${bet.id}: ` +
          `${result.price} (via ${result.bookKey}), CLV: ${clv.toFixed(2)}%`
        )
        captured++
      }
    }
  }

  return NextResponse.json({
    captured,
    total: bets.length,
    ...(failedIds.length > 0 && { missed: failedIds }),
  })
}
