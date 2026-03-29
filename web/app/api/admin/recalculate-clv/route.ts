import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import { calcCLV } from '@/lib/odds-api'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .not('closing_odds', 'is', null)

  if (error) {
    console.error('[recalculate-clv] DB fetch error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const bets = (data ?? []) as Bet[]

  // Group by arb_id
  const byArb = new Map<string, Bet[]>()
  for (const bet of bets) {
    const group = byArb.get(bet.arb_id) ?? []
    group.push(bet)
    byArb.set(bet.arb_id, group)
  }

  let updated = 0
  let skipped = 0

  for (const [, arbBets] of byArb) {
    if (arbBets.length === 2) {
      const [betA, betB] = arbBets
      if (betA.closing_odds == null || betB.closing_odds == null) {
        skipped += 2
        continue
      }
      // Use sibling's closing_odds as the opposing price for de-vig
      const clvA = calcCLV(betA.odds, betA.closing_odds, betB.closing_odds)
      const clvB = calcCLV(betB.odds, betB.closing_odds, betA.closing_odds)

      await supabase.from('bets').update({ clv: clvA }).eq('id', betA.id)
      await supabase.from('bets').update({ clv: clvB }).eq('id', betB.id)
      updated += 2
    } else if (arbBets.length === 1) {
      const bet = arbBets[0]
      if (bet.closing_odds == null) { skipped++; continue }
      const clv = calcCLV(bet.odds, bet.closing_odds, null)
      await supabase.from('bets').update({ clv }).eq('id', bet.id)
      updated++
    } else {
      // 3-way markets — skip, de-vig formula doesn't apply cleanly
      skipped += arbBets.length
    }
  }

  console.log(`[recalculate-clv] updated=${updated}, skipped=${skipped}, total=${bets.length}`)
  return NextResponse.json({ updated, skipped, total: bets.length })
}
