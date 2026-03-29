import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import { ODDS_API_SPORT_MAP, fetchOdds, findClosingOdds, calcCLV, OddsEvent } from '@/lib/odds-api'

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

  // Fetch bets within ±10 minutes of game start with no closing odds yet
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

  // Group bets by sport key to minimize Odds API calls
  const bySport = new Map<string, Bet[]>()
  for (const bet of bets) {
    if (!bet.sport || !bet.market) continue

    const sportKey = bet.sport.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
    const oddsKey = ODDS_API_SPORT_MAP[sportKey]
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

      const clv = calcCLV(bet.odds, result.price)

      const { error: updateError } = await supabase
        .from('bets')
        .update({ closing_odds: result.price, clv })
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
