import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import { parseTeamsFromBetName } from '@/lib/espn'
import {
  ODDS_API_SPORT_MAP,
  PROP_MARKET_KEY_MAP,
  fetchOdds,
  fetchEventOdds,
  findClosingOdds,
  findPropClosingOdds,
  findEvent,
  parsePropMarketStr,
  calcCLV,
  OddsEvent,
} from '@/lib/odds-api'

const FEATURED_MARKETS = new Set(['Moneyline', 'Spread', 'Total'])

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

  // Fetch bets whose game starts within the next 2 minutes (always before game time)
  const now = new Date()
  const windowStart = now.toISOString()
  const windowEnd = new Date(now.getTime() + 2 * 60 * 1000).toISOString()

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

  function toOddsSportKey(sport: string): string | null {
    return ODDS_API_SPORT_MAP[sport.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()] ?? null
  }

  // Group featured-market bets by sport key to minimize Odds API calls
  const bySport = new Map<string, Bet[]>()
  for (const bet of bets) {
    if (!bet.sport || !bet.market) continue
    if (!FEATURED_MARKETS.has(bet.market)) continue   // props handled separately

    const oddsKey = toOddsSportKey(bet.sport)
    if (!oddsKey) {
      console.warn(`[closing-odds-cron] No Odds API key for sport: "${bet.sport}" (bet ${bet.id})`)
      continue
    }
    const group = bySport.get(oddsKey) ?? []
    group.push(bet)
    bySport.set(oddsKey, group)
  }

  // Cache fetched events per sport key
  const oddsCache = new Map<string, OddsEvent[]>()

  let captured = 0
  const failedIds: string[] = []

  for (const [sportKey, sportBets] of bySport) {
    // Fetch odds for this sport (cached)
    if (!oddsCache.has(sportKey)) {
      try {
        const events = await fetchOdds(sportKey, apiKey)
        oddsCache.set(sportKey, events)
        console.log(`[closing-odds-cron] Fetched ${events.length} events for ${sportKey}`)
      } catch (err) {
        console.error(`[closing-odds-cron] fetchOdds failed for ${sportKey}:`, err)
        continue
      }
    }
    const events = oddsCache.get(sportKey)!

    for (const bet of sportBets) {
      const result = findClosingOdds(events, bet)
      if (!result) {
        console.warn(`[closing-odds-cron] No closing odds found for bet ${bet.id}`)
        failedIds.push(bet.id)
        continue
      }

      const clv = calcCLV(bet.odds, result.price, result.opposingPrice)

      const { error: updateError } = await supabase
        .from('bets')
        .update({ closing_odds: result.price, closing_book: result.bookKey, clv })
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

  // ── Prop bets second pass ────────────────────────────────────────────────────
  const propBets = bets.filter(b => b.market && !FEATURED_MARKETS.has(b.market))

  if (propBets.length > 0) {
    console.log(`[closing-odds-cron] Processing ${propBets.length} prop bets`)
    // Cache: "sportKey/eventId/marketKey" → OddsEvent (one credit each)
    const propOddsCache = new Map<string, OddsEvent>()

    for (const bet of propBets) {
      if (!bet.sport || !bet.market || !bet.line) continue

      const sportKey = toOddsSportKey(bet.sport)
      if (!sportKey) {
        console.warn(`[closing-odds-cron] No Odds API key for sport: "${bet.sport}" (bet ${bet.id})`)
        continue
      }

      const parsed = parsePropMarketStr(bet.market)
      if (!parsed) {
        console.warn(`[closing-odds-cron] Cannot parse prop market: "${bet.market}" (bet ${bet.id})`)
        failedIds.push(bet.id)
        continue
      }

      const propMarketKey = PROP_MARKET_KEY_MAP[parsed.statType]
      if (!propMarketKey) {
        console.warn(`[closing-odds-cron] Unsupported prop stat type: "${parsed.statType}" (bet ${bet.id})`)
        continue
      }

      // Need the bulk events to look up the eventId
      if (!oddsCache.has(sportKey)) {
        try {
          const events = await fetchOdds(sportKey, apiKey)
          oddsCache.set(sportKey, events)
          console.log(`[closing-odds-cron] Fetched ${events.length} events for ${sportKey}`)
        } catch (err) {
          console.error(`[closing-odds-cron] fetchOdds failed for ${sportKey}:`, err)
          failedIds.push(bet.id)
          continue
        }
      }
      const bulkEvents = oddsCache.get(sportKey)!

      const teams = parseTeamsFromBetName(bet.bet_name)
      const matchedEvent = teams ? findEvent(bulkEvents, teams[0], teams[1]) : null
      if (!matchedEvent) {
        console.warn(`[closing-odds-cron] No event match for prop bet ${bet.id} ("${bet.bet_name}")`)
        failedIds.push(bet.id)
        continue
      }

      const dirMatch = bet.line.match(/^(Over|Under)\s+([\d.]+)/i)
      if (!dirMatch) {
        console.warn(`[closing-odds-cron] Cannot parse direction/value from line: "${bet.line}" (bet ${bet.id})`)
        failedIds.push(bet.id)
        continue
      }
      const direction = dirMatch[1].toLowerCase()
      const lineValue = parseFloat(dirMatch[2])

      const cacheKey = `${sportKey}/${matchedEvent.id}/${propMarketKey}`
      if (!propOddsCache.has(cacheKey)) {
        try {
          const propEvent = await fetchEventOdds(sportKey, matchedEvent.id, propMarketKey, apiKey)
          propOddsCache.set(cacheKey, propEvent)
        } catch (err) {
          console.error(`[closing-odds-cron] fetchEventOdds failed for ${cacheKey}:`, err)
          failedIds.push(bet.id)
          continue
        }
      }
      const propEvent = propOddsCache.get(cacheKey)!

      const result = findPropClosingOdds(propEvent, propMarketKey, parsed.lastName, parsed.firstInitial, direction, lineValue)
      if (!result) {
        console.warn(`[closing-odds-cron] No prop closing odds for bet ${bet.id}`)
        failedIds.push(bet.id)
        continue
      }

      const clv = calcCLV(bet.odds, result.price, result.opposingPrice)

      const { error: updateError } = await supabase
        .from('bets')
        .update({ closing_odds: result.price, closing_book: result.bookKey, clv })
        .eq('id', bet.id)

      if (updateError) {
        console.error(`[closing-odds-cron] Update failed for bet ${bet.id}:`, updateError)
        failedIds.push(bet.id)
      } else {
        console.log(
          `[closing-odds-cron] Captured prop closing odds for bet ${bet.id}: ` +
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
