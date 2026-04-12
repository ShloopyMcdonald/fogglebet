'use server'

import { supabase, Bet } from '@/lib/supabase'
import { refresh } from 'next/cache'

export async function deleteArb(arbId: string, _formData?: FormData): Promise<void> {
  const { error } = await supabase
    .from('bets')
    .delete()
    .eq('arb_id', arbId)

  if (error) {
    console.error('Failed to delete arb:', error)
    throw new Error('Delete failed')
  }

  refresh()
}

export async function takeTrainingBet(betId: string, stake: number): Promise<void> {
  const { data: betData, error: e1 } = await supabase
    .from('bets')
    .select('*')
    .eq('id', betId)
    .single()
  const bet = betData as Bet | null
  if (e1 || !bet) throw new Error('Bet not found')
  if (!bet.is_training) throw new Error('Bet is not a training bet')

  const { data: siblingData, error: e2 } = await supabase
    .from('bets')
    .select('*')
    .eq('arb_id', bet.arb_id)
    .neq('id', betId)
  const siblings = siblingData as Bet[] | null
  if (e2 || !siblings || siblings.length === 0) throw new Error('Sibling leg not found')
  const sibling = siblings[0]

  const newArbId = crypto.randomUUID()

  function copyFields(src: Bet) {
    return {
      game_time: src.game_time,
      bet_name: src.bet_name,
      sport: src.sport,
      market: src.market,
      line: src.line,
      book: src.book,
      odds: src.odds,
      liquidity: src.liquidity,
      ev_percent: src.ev_percent,
      arb_percent: src.arb_percent,
      book_odds: src.book_odds,
      source_url: src.source_url,
      notes: src.notes,
    }
  }

  const rows = [
    {
      ...copyFields(bet),
      arb_id: newArbId,
      is_taken: true,
      is_training: false,
      stake,
      result: 'pending',
      closing_odds: null,
      closing_book: null,
      closing_odds_raw: null,
      closing_odds_recorded_at: null,
      clv: null,
      clv_checked: false,
      profit_loss: null,
    },
    {
      ...copyFields(sibling),
      arb_id: newArbId,
      is_taken: false,
      is_training: false,
      stake: 1,
      result: 'pending',
      closing_odds: null,
      closing_book: null,
      closing_odds_raw: null,
      closing_odds_recorded_at: null,
      clv: null,
      clv_checked: false,
      profit_loss: null,
    },
  ]

  const { error: e3 } = await supabase.from('bets').insert(rows)
  if (e3) throw new Error('Failed to create taken bet')
}

export async function deleteTodaysBets(): Promise<{ deleted: number }> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('bets')
    .delete()
    .gte('recorded_at', todayStart.toISOString())
    .select('id')

  if (error) {
    console.error('Failed to delete today\'s bets:', error)
    throw new Error('Delete failed')
  }

  refresh()
  return { deleted: data?.length ?? 0 }
}
