import { Bet } from './supabase'
import { parseTeamsFromBetName } from './espn'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OddsOutcome {
  name: string         // team name, "Over", or "Under"
  price: number        // American odds
  point?: number       // spread or total value
  description?: string // player full name for prop markets (e.g. "Luka Doncic")
}

export interface OddsMarket {
  key: string           // "h2h" | "spreads" | "totals"
  outcomes: OddsOutcome[]
}

export interface OddsBookmaker {
  key: string           // "draftkings", "fanduel", etc.
  markets: OddsMarket[]
}

export interface OddsEvent {
  id: string
  sport_key: string
  commence_time: string // ISO UTC
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

// picktheodds sport name → The Odds API sport key
export const ODDS_API_SPORT_MAP: Record<string, string> = {
  NBA:                     'basketball_nba',
  NCAAB:                   'basketball_ncaab',
  WNBA:                    'basketball_wnba',
  NFL:                     'americanfootball_nfl',
  NCAAF:                   'americanfootball_ncaaf',
  MLB:                     'baseball_mlb',
  NHL:                     'icehockey_nhl',
  MLS:                     'soccer_usa_mls',
  EPL:                     'soccer_epl',
  'PREMIER LEAGUE':        'soccer_epl',
  LALIGA:                  'soccer_spain_la_liga',
  'LA LIGA':               'soccer_spain_la_liga',
  BUNDESLIGA:              'soccer_germany_bundesliga',
  'SERIE A':               'soccer_italy_serie_a',
  'LIGUE 1':               'soccer_france_ligue_1',
  UCL:                     'soccer_uefa_champs_league',
  'CHAMPIONS LEAGUE':      'soccer_uefa_champs_league',
  'UEFA CHAMPIONS LEAGUE': 'soccer_uefa_champs_league',
  UEL:                     'soccer_uefa_europa_league',
  'EUROPA LEAGUE':         'soccer_uefa_europa_league',
}

// Markets we support: Odds API key → our market name
const MARKET_KEY_MAP: Record<string, string> = {
  h2h:     'Moneyline',
  spreads: 'Spread',
  totals:  'Total',
}

// Reverse: our market name → Odds API key
const BET_MARKET_TO_ODDS_KEY: Record<string, string> = {
  Moneyline: 'h2h',
  Spread:    'spreads',
  Total:     'totals',
}

// Books in priority order for closing odds reference (Odds API keys)
// Sharp books first, soft books appended after
const SHARP_BOOK_PRIORITY = [
  'pinnacle',
  'betonlineag',   // BetOnline.ag — sharp, takes action
  'fanduel',
  'draftkings',
  'betmgm',
  'caesars',
  'williamhill_us',
  'pointsbetus',
  'bookmaker',     // BookMaker.eu — soft book
]

// statType (from bet.market "Points - Doncic, L") → Odds API player prop market key
export const PROP_MARKET_KEY_MAP: Record<string, string> = {
  // Basketball
  Points:            'player_points',
  Rebounds:          'player_rebounds',
  Assists:           'player_assists',
  Blocks:            'player_blocks',
  Steals:            'player_steals',
  Turnovers:         'player_turnovers',
  '3-Pointers Made': 'player_threes',
  // Football
  'Pass Yards':      'player_pass_yds',
  'Pass TDs':        'player_pass_tds',
  Interceptions:     'player_pass_interceptions',
  'Rush Yards':      'player_rush_yds',
  'Rushing TDs':     'player_rush_tds',
  'Receiving Yards': 'player_reception_yds',
  Receptions:        'player_receptions',
  'Receiving TDs':   'player_reception_tds',
  // Baseball (picktheodds context: Strikeouts = pitcher)
  Strikeouts:        'pitcher_strikeouts',
  Hits:              'batter_hits',
  'Home Runs':       'batter_home_runs',
  RBIs:              'batter_rbis',
  'Total Bases':     'batter_total_bases',
  Runs:              'batter_runs_scored',
  // Hockey
  Goals:             'player_goals',
  Shots:             'player_shots_on_goal',
}

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports'

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatchesName(keyword: string, teamName: string): boolean {
  const kw = normalize(keyword)
  const tn = normalize(teamName)
  return tn === kw || tn.includes(kw) || kw.includes(tn)
}

// ── API Fetching ──────────────────────────────────────────────────────────────

export async function fetchOdds(sportKey: string, apiKey: string): Promise<OddsEvent[]> {
  // regions=us only: cost = 3 credits (1 per market). us,us2,eu would be 9.
  const url =
    `${ODDS_API_BASE}/${sportKey}/odds` +
    `?apiKey=${apiKey}` +
    `&regions=us` +
    `&markets=h2h,spreads,totals` +
    `&oddsFormat=american`

  const res = await fetch(url, { cache: 'no-store' })
  // Log quota usage from response headers
  const remaining = res.headers.get('x-requests-remaining')
  const used = res.headers.get('x-requests-used')
  const cost = res.headers.get('x-requests-last')
  console.log(`[odds-api] ${sportKey} quota — cost: ${cost}, used: ${used}, remaining: ${remaining}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchOdds ${sportKey} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsEvent[]>
}

// Fetches odds for a single event — required for player prop markets
// Returns the event with bookmakers populated for the requested market only
export async function fetchEventOdds(
  sportKey: string,
  eventId: string,
  marketKey: string,
  apiKey: string
): Promise<OddsEvent> {
  const url =
    `${ODDS_API_BASE}/${sportKey}/events/${eventId}/odds` +
    `?apiKey=${apiKey}` +
    `&regions=us` +
    `&markets=${marketKey}` +
    `&oddsFormat=american`

  const res = await fetch(url, { cache: 'no-store' })
  const remaining = res.headers.get('x-requests-remaining')
  const used = res.headers.get('x-requests-used')
  const cost = res.headers.get('x-requests-last')
  console.log(`[odds-api] event-odds ${eventId}/${marketKey} quota — cost: ${cost}, used: ${used}, remaining: ${remaining}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEventOdds ${eventId}/${marketKey} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsEvent>
}

// ── Player Prop Helpers ───────────────────────────────────────────────────────

// "Points - Doncic, L" → { statType: "Points", lastName: "Doncic", firstInitial: "L" }
export function parsePropMarketStr(
  market: string
): { statType: string; lastName: string; firstInitial: string } | null {
  const dashIdx = market.indexOf(' - ')
  if (dashIdx === -1) return null
  const statType = market.slice(0, dashIdx).trim()
  const playerPart = market.slice(dashIdx + 3).trim()
  const commaIdx = playerPart.indexOf(',')
  if (commaIdx === -1) {
    return { statType, lastName: playerPart, firstInitial: '' }
  }
  return {
    statType,
    lastName: playerPart.slice(0, commaIdx).trim(),
    firstInitial: playerPart.slice(commaIdx + 1).trim(),
  }
}

// Match prop outcome: direction (over/under) + player lastName in description
export function findPropClosingOdds(
  event: OddsEvent,
  propMarketKey: string,
  lastName: string,
  _firstInitial: string,
  direction: string,  // "over" or "under" (lowercased)
  lineValue: number   // exact prop line, e.g. 24.5 — must match outcome.point
): ClosingOddsResult | null {
  const lastNameNorm = normalize(lastName)

  const bookmakerOrder = [
    ...SHARP_BOOK_PRIORITY,
    ...event.bookmakers
      .map(b => b.key)
      .filter(k => !SHARP_BOOK_PRIORITY.includes(k)),
  ]

  for (const bookKey of bookmakerOrder) {
    const bookmaker = event.bookmakers.find(b => b.key === bookKey)
    if (!bookmaker) continue

    const market = bookmaker.markets.find(m => m.key === propMarketKey)
    if (!market) continue

    const outcome = market.outcomes.find(o => {
      if (o.name.toLowerCase() !== direction) return false
      if (!o.description) return false
      if (o.point == null || Math.abs(o.point - lineValue) >= 0.1) return false
      return normalize(o.description).includes(lastNameNorm)
    })

    if (outcome) {
      const opposingDirection = direction === 'over' ? 'under' : 'over'
      const opposing = market.outcomes.find(o => {
        if (o.name.toLowerCase() !== opposingDirection) return false
        if (!o.description) return false
        if (o.point == null || Math.abs(o.point - lineValue) >= 0.1) return false
        return normalize(o.description).includes(lastNameNorm)
      })
      return { price: outcome.price, opposingPrice: opposing?.price ?? null, bookKey }
    }
  }

  console.warn(
    `[odds-api] No prop outcome found: ${propMarketKey} / ${direction} / ${lastName}`
  )
  return null
}

// ── Event Matching ────────────────────────────────────────────────────────────

export function findEvent(events: OddsEvent[], team1: string, team2: string): OddsEvent | null {
  for (const ev of events) {
    const hasTeam1 = teamMatchesName(team1, ev.home_team) || teamMatchesName(team1, ev.away_team)
    const hasTeam2 = teamMatchesName(team2, ev.home_team) || teamMatchesName(team2, ev.away_team)
    if (hasTeam1 && hasTeam2) return ev
  }
  return null
}

// ── Outcome Matching ──────────────────────────────────────────────────────────

// Parse "Warriors -3" → { teamKeyword: "Warriors", spread: -3 }
function parseSpreadLine(line: string): { teamKeyword: string; spread: number } | null {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  if (isNaN(spread)) return null
  return { teamKeyword: m[1].trim(), spread }
}

function findOutcome(
  market: OddsMarket,
  betMarket: string,
  betLine: string
): OddsOutcome | null {
  if (betMarket === 'Moneyline') {
    // betLine = team name or "Draw"
    return (
      market.outcomes.find(o => teamMatchesName(betLine, o.name)) ?? null
    )
  }

  if (betMarket === 'Spread') {
    // betLine = "Warriors -3" — must match both team and exact spread point
    const parsed = parseSpreadLine(betLine)
    if (!parsed) return null
    return (
      market.outcomes.find(o =>
        teamMatchesName(parsed.teamKeyword, o.name) &&
        o.point != null && Math.abs(o.point - parsed.spread) < 0.1
      ) ?? null
    )
  }

  if (betMarket === 'Total') {
    // betLine = "Over 200.5" or "Under 180.5" — must match both direction and exact total
    const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
    if (!m) return null
    const direction = m[1].toLowerCase()
    const total = parseFloat(m[2])
    return (
      market.outcomes.find(o =>
        o.name.toLowerCase() === direction &&
        o.point != null && Math.abs(o.point - total) < 0.1
      ) ?? null
    )
  }

  return null
}

// ── Main: find closing odds for a bet ─────────────────────────────────────────

export interface ClosingOddsResult {
  price: number              // American odds at closing (our side)
  opposingPrice: number | null  // opposing outcome's odds (same book) — used for de-vig
  bookKey: string            // which bookmaker was used
}

export function findClosingOdds(
  events: OddsEvent[],
  bet: Bet
): ClosingOddsResult | null {
  const marketOddsKey = BET_MARKET_TO_ODDS_KEY[bet.market ?? '']
  if (!marketOddsKey) {
    // Player props and unknown markets skipped for now
    return null
  }

  const teams = parseTeamsFromBetName(bet.bet_name)
  if (!teams) {
    console.warn(`[odds-api] Cannot parse teams from: "${bet.bet_name}"`)
    return null
  }

  const event = findEvent(events, teams[0], teams[1])
  if (!event) {
    console.warn(`[odds-api] No event match for "${bet.bet_name}"`)
    return null
  }

  if (!bet.line) {
    console.warn(`[odds-api] No line on bet ${bet.id}`)
    return null
  }

  // Try sharp books first, then any available bookmaker
  const bookmakerOrder = [
    ...SHARP_BOOK_PRIORITY,
    ...event.bookmakers
      .map(b => b.key)
      .filter(k => !SHARP_BOOK_PRIORITY.includes(k)),
  ]

  for (const bookKey of bookmakerOrder) {
    const bookmaker = event.bookmakers.find(b => b.key === bookKey)
    if (!bookmaker) continue

    const market = bookmaker.markets.find(m => m.key === marketOddsKey)
    if (!market) continue

    const outcome = findOutcome(market, bet.market!, bet.line)
    if (outcome) {
      const opposing = market.outcomes.find(o => o !== outcome)
      return { price: outcome.price, opposingPrice: opposing?.price ?? null, bookKey }
    }
  }

  console.warn(
    `[odds-api] No matching outcome for bet ${bet.id} (${bet.market} / ${bet.line})`
  )
  return null
}

// ── CLV Calculation ───────────────────────────────────────────────────────────

function impliedProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (100 + americanOdds)
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
}

// TKO (Theoretical Kelly Optimization) de-vig for two-way markets.
// Source: https://www.pinnacle.com/en/betting-articles/Betting-Strategy/why-the-favourite-longshot-bias-is-not-a-bias/
// Formula: b0 = log[p2/(1-p1)] / log[p1/(1-p2)], true_fav = b0/(1+b0)
// where p1 = favourite implied prob, p2 = longshot implied prob.
// Falls back to additive if the formula is degenerate (effectively zero vig).
function deVigTKO(pA: number, pB: number): number {
  const aIsFav = pA >= pB
  const p1 = aIsFav ? pA : pB  // favourite
  const p2 = aIsFav ? pB : pA  // longshot

  const num = Math.log(p2 / (1 - p1))
  const den = Math.log(p1 / (1 - p2))

  if (!isFinite(num) || !isFinite(den) || Math.abs(den) < 1e-10) {
    return pA / (pA + pB)  // additive fallback
  }

  const b0 = num / den
  const trueFav = b0 / (1 + b0)
  return aIsFav ? trueFav : 1 - trueFav
}

// Positive CLV = you beat the closing line (good)
// Negative CLV = line moved against you
// When opposingClosingOdds is provided, de-vigs the closing line (TKO method)
// so both sides of an arb don't both appear as positive CLV.
export function calcCLV(
  betOdds: number,
  closingOdds: number,
  opposingClosingOdds: number | null
): number {
  const closingP = impliedProb(closingOdds)
  if (opposingClosingOdds != null) {
    const opposingP = impliedProb(opposingClosingOdds)
    const fairP = deVigTKO(closingP, opposingP)
    return (fairP - impliedProb(betOdds)) * 100
  }
  return (closingP - impliedProb(betOdds)) * 100
}

// ── Export market key map for use in route ────────────────────────────────────
export { MARKET_KEY_MAP }

