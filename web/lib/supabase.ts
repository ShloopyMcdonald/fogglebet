import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type BetResult = 'pending' | 'win' | 'loss' | 'push'

export interface Bet {
  id: string
  arb_id: string
  is_taken: boolean
  recorded_at: string
  game_time: string | null
  bet_name: string
  sport: string | null
  market: string | null
  line: string | null
  book: string
  odds: number
  liquidity: number | null
  ev_percent: number | null
  arb_percent: number | null
  closing_odds: number | null
  clv: number | null
  result: BetResult
  profit_loss: number | null
  stake: number
  source_url: string | null
  notes: string | null
}
