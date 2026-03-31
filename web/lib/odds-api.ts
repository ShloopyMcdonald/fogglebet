import { Bet } from './supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OddsApiOdds {
  home?: number
  away?: number
  draw?: number
  over?: number
  under?: number
  hdp?: number
  label?: string  // player name for prop markets
}

export interface OddsApiMarket {
  name: string   // "ML", "Spread", "Totals", "Player Props - Points", etc.
  updatedAt: string
  odds: OddsApiOdds[]
}

export interface OddsApiBookmakerEntry {
  name: string   // "Pinnacle", "DraftKings", etc.
  markets: OddsApiMarket[]
}

export interface OddsApiEvent {
  id: string
  home: string
  away: string
  date: string   // ISO UTC
  status: string
  sport: { name: string; slug: string }
  league: { name: string; slug: string }
}

export interface OddsApiOddsResponse extends OddsApiEvent {
  bookmakers: OddsApiBookmakerEntry[]
}

export interface ClosingOddsResult {
  price: number
  opposingPrice: number | null
  bookKey: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ODDS_API_IO_BASE = 'https://api.odds-api.io/v3'

// picktheodds sport name → odds-api.io sport slug
export const ODDS_API_SPORT_SLUGS: Record<string, string> = {
  NBA:                     'basketball',
  NCAAB:                   'basketball',
  WNBA:                    'basketball',
  NFL:                     'americanfootball',
  NCAAF:                   'americanfootball',
  MLB:                     'baseball',
  NHL:                     'icehockey',
  MLS:                     'football',
  EPL:                     'football',
  'PREMIER LEAGUE':        'football',
  LALIGA:                  'football',
  'LA LIGA':               'football',
  BUNDESLIGA:              'football',
  'SERIE A':               'football',
  'LIGUE 1':               'football',
  UCL:                     'football',
  'CHAMPIONS LEAGUE':      'football',
  'UEFA CHAMPIONS LEAGUE': 'football',
  UEL:                     'football',
  'EUROPA LEAGUE':         'football',
}

// Books to request and prioritize for closing odds (sharp first).
// NOTE: Exact names must be verified against GET /v3/bookmakers once the API key is active.
export const SHARP_BOOK_PRIORITY = [
  'Pinnacle',
  'BetOnline',
  'FanDuel',
  'DraftKings',
  'BetMGM',
  'Caesars',
  'PointsBet',
  'BookMaker',
]

// Our internal market name → odds-api.io market name string.
// NOTE: Verify "ML" / "Spread" / "Totals" against a live /odds response.
const MARKET_NAME_MAP: Record<string, string> = {
  Moneyline: 'ML',
  Spread:    'Spread',
  Total:     'Totals',
}

// picktheodds stat type → odds-api.io "Player Props - {suffix}" market name suffix.
// NOTE: Verify exact suffix strings against a live /odds response for prop markets.
export const PROP_STAT_TO_MARKET_NAME: Record<string, string> = {
  // Basketball
  Points:            'Points',
  Rebounds:          'Rebounds',
  Assists:           'Assists',
  Blocks:            'Blocks',
  Steals:            'Steals',
  Turnovers:         'Turnovers',
  '3-Pointers Made': '3-Pointers',
  '3PT':             '3-Pointers',
  // Football
  'Pass Yards':      'Passing Yards',
  'Pass TDs':        'Passing Touchdowns',
  Interceptions:     'Passing Interceptions',
  'Rush Yards':      'Rushing Yards',
  'Rushing TDs':     'Rushing Touchdowns',
  'Receiving Yards': 'Receiving Yards',
  Receptions:        'Receptions',
  'Receiving TDs':   'Receiving Touchdowns',
  // Baseball
  Strikeouts:        'Strikeouts',
  Hits:              'Hits',
  'Home Runs':       'Home Runs',
  RBIs:              'RBIs',
  'Total Bases':     'Total Bases',
  Runs:              'Runs Scored',
  // Hockey
  Goals:             'Goals',
  Shots:             'Shots on Goal',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatchesName(keyword: string, teamName: string): boolean {
  const kw = normalize(keyword)
  const tn = normalize(teamName)
  return tn === kw || tn.includes(kw) || kw.includes(tn)
}

// Decimal odds (e.g. 1.91) → American odds (e.g. -110)
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

// Parse "Warriors -3" → { teamKeyword: "Warriors", spread: -3 }
function parseSpreadLine(line: string): { teamKeyword: string; spread: number } | null {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  if (isNaN(spread)) return null
  return { teamKeyword: m[1].trim(), spread }
}

// ── API Fetching ──────────────────────────────────────────────────────────────

// Returns events for a sport within a time window. Used to resolve team names → event IDs.
export async function fetchEvents(
  sportSlug: string,
  from: string,
  to: string,
  apiKey: string
): Promise<OddsApiEvent[]> {
  const params = new URLSearchParams({
    apiKey,
    sport: sportSlug,
    from,
    to,
    status: 'pending,live',
    limit: '100',
  })
  const res = await fetch(`${ODDS_API_IO_BASE}/events?${params}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEvents ${sportSlug} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsApiEvent[]>
}

// Returns full odds (all markets) for a single event from the specified bookmakers.
export async function fetchEventOddsById(
  eventId: string,
  bookmakers: string[],
  apiKey: string
): Promise<OddsApiOddsResponse> {
  const params = new URLSearchParams({
    apiKey,
    eventId,
    bookmakers: bookmakers.join(','),
  })
  const res = await fetch(`${ODDS_API_IO_BASE}/odds?${params}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEventOddsById ${eventId} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsApiOddsResponse>
}

// ── Event Matching ────────────────────────────────────────────────────────────

export function findEvent(events: OddsApiEvent[], team1: string, team2: string): OddsApiEvent | null {
  for (const ev of events) {
    const hasTeam1 = teamMatchesName(team1, ev.home) || teamMatchesName(team1, ev.away)
    const hasTeam2 = teamMatchesName(team2, ev.home) || teamMatchesName(team2, ev.away)
    if (hasTeam1 && hasTeam2) return ev
  }
  return null
}

// ── Outcome Extraction ────────────────────────────────────────────────────────

function extractMoneylineOdds(
  event: OddsApiOddsResponse,
  odds: OddsApiOdds,
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  if (betLine.toLowerCase() === 'draw') {
    if (odds.draw == null) return null
    return { price: decimalToAmerican(odds.draw), opposingPrice: null }
  }
  const isHome = teamMatchesName(betLine, event.home)
  const isAway = teamMatchesName(betLine, event.away)
  if (isHome && odds.home != null) {
    return {
      price: decimalToAmerican(odds.home),
      opposingPrice: odds.away != null ? decimalToAmerican(odds.away) : null,
    }
  }
  if (isAway && odds.away != null) {
    return {
      price: decimalToAmerican(odds.away),
      opposingPrice: odds.home != null ? decimalToAmerican(odds.home) : null,
    }
  }
  return null
}

function extractSpreadOdds(
  event: OddsApiOddsResponse,
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const parsed = parseSpreadLine(betLine)
  if (!parsed) return null

  const betIsHome = teamMatchesName(parsed.teamKeyword, event.home)
  const betIsAway = teamMatchesName(parsed.teamKeyword, event.away)
  if (!betIsHome && !betIsAway) return null

  // hdp = home team's handicap (e.g. -3 means home is -3 favorite).
  // If bet is on home at -3: targetHdp = -3, our price = entry.home.
  // If bet is on away at +3: home's hdp = -3, so targetHdp = -parsed.spread = -3, our price = entry.away.
  const targetHdp = betIsHome ? parsed.spread : -parsed.spread
  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - targetHdp) < 0.1)
  if (!entry) return null

  const ourPrice = betIsHome ? entry.home : entry.away
  const opposingPrice = betIsHome ? entry.away : entry.home
  if (ourPrice == null) return null

  return {
    price: decimalToAmerican(ourPrice),
    opposingPrice: opposingPrice != null ? decimalToAmerican(opposingPrice) : null,
  }
}

function extractTotalOdds(
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const totalValue = parseFloat(m[2])

  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - totalValue) < 0.1)
  if (!entry) return null

  if (direction === 'over' && entry.over != null) {
    return {
      price: decimalToAmerican(entry.over),
      opposingPrice: entry.under != null ? decimalToAmerican(entry.under) : null,
    }
  }
  if (direction === 'under' && entry.under != null) {
    return {
      price: decimalToAmerican(entry.under),
      opposingPrice: entry.over != null ? decimalToAmerican(entry.over) : null,
    }
  }
  return null
}

function extractPropOdds(
  oddsArr: OddsApiOdds[],
  lastName: string,
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const lineValue = parseFloat(m[2])
  const lastNameNorm = normalize(lastName)

  const entry = oddsArr.find(o => {
    if (!o.label) return false
    if (o.hdp == null || Math.abs(o.hdp - lineValue) >= 0.1) return false
    return normalize(o.label).includes(lastNameNorm)
  })
  if (!entry) return null

  if (direction === 'over' && entry.over != null) {
    return {
      price: decimalToAmerican(entry.over),
      opposingPrice: entry.under != null ? decimalToAmerican(entry.under) : null,
    }
  }
  if (direction === 'under' && entry.under != null) {
    return {
      price: decimalToAmerican(entry.under),
      opposingPrice: entry.over != null ? decimalToAmerican(entry.over) : null,
    }
  }
  return null
}

// ── Player Prop Market Parsing ────────────────────────────────────────────────

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

// ── Main: find closing odds for a bet ─────────────────────────────────────────

function extractOddsFromBookmaker(
  event: OddsApiOddsResponse,
  bm: OddsApiBookmakerEntry,
  bet: Bet
): { price: number; opposingPrice: number | null } | null {
  const market = bet.market!
  const line = bet.line!

  if (market === 'Moneyline') {
    const mkt = bm.markets.find(m => m.name === MARKET_NAME_MAP['Moneyline'])
    if (!mkt || mkt.odds.length === 0) return null
    return extractMoneylineOdds(event, mkt.odds[0], line)
  }

  if (market === 'Spread') {
    const mkt = bm.markets.find(m => m.name === MARKET_NAME_MAP['Spread'])
    if (!mkt) return null
    return extractSpreadOdds(event, mkt.odds, line)
  }

  if (market === 'Total' || market.startsWith('Total ')) {
    const mkt = bm.markets.find(m => m.name === MARKET_NAME_MAP['Total'])
    if (!mkt) return null
    return extractTotalOdds(mkt.odds, line)
  }

  // Player prop: e.g. "Points - Doncic, L"
  const parsed = parsePropMarketStr(market)
  if (parsed) {
    const suffix = PROP_STAT_TO_MARKET_NAME[parsed.statType]
    if (!suffix) return null
    const mkt = bm.markets.find(m => m.name === `Player Props - ${suffix}`)
    if (!mkt) return null
    return extractPropOdds(mkt.odds, parsed.lastName, line)
  }

  return null
}

export function findClosingOdds(
  oddsResp: OddsApiOddsResponse,
  bet: Bet
): ClosingOddsResult | null {
  if (!bet.market || !bet.line) {
    console.warn(`[odds-api] Bet ${bet.id} missing market or line`)
    return null
  }

  // Try sharp books first, then any remaining bookmakers in the response
  const bookOrder = [
    ...SHARP_BOOK_PRIORITY,
    ...oddsResp.bookmakers
      .map(b => b.name)
      .filter(n => !SHARP_BOOK_PRIORITY.includes(n)),
  ]

  for (const bookName of bookOrder) {
    const bm = oddsResp.bookmakers.find(b => b.name === bookName)
    if (!bm) continue

    const result = extractOddsFromBookmaker(oddsResp, bm, bet)
    if (result) return { ...result, bookKey: bookName }
  }

  console.warn(
    `[odds-api] No closing odds found for bet ${bet.id} (${bet.market} / ${bet.line})`
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

// Positive CLV = you beat the closing line (good).
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
