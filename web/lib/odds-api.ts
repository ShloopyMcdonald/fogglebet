import { Bet } from './supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OddsApiOdds {
  hdp?: number
  home?: string    // decimal odds as string, e.g. "1.91" or "N/A"
  away?: string
  draw?: string
  over?: string
  under?: string
  label?: string   // player + stat type, e.g. "Paolo Banchero (Points)"
}

export interface OddsApiMarket {
  name: string     // "ML", "Spread", "Totals", "Player Props"
  updatedAt: string
  odds: OddsApiOdds[]
}

// bookmakers is a dict keyed by bookmaker name, NOT an array
export interface OddsApiOddsResponse {
  id: number
  home: string
  away: string
  date: string
  status: string
  sport: { name: string; slug: string }
  league: { name: string; slug: string }
  bookmakers: Record<string, OddsApiMarket[]>
}

export interface OddsApiEvent {
  id: number
  home: string
  away: string
  date: string
  status: string
  sport: { name: string; slug: string }
  league: { name: string; slug: string }
}

export interface ClosingOddsResult {
  price: number
  opposingPrice: number | null
  bookKey: string
  rawEntry: OddsApiOdds
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ODDS_API_IO_BASE = 'https://api.odds-api.io/v3'

// picktheodds sport name → odds-api.io sport slug
export const ODDS_API_SPORT_SLUGS: Record<string, string> = {
  // Basketball
  nba:                     'basketball',
  ncaab:                   'basketball',
  wnba:                    'basketball',
  basketball:              'basketball',
  // American Football
  nfl:                     'american-football',
  ncaaf:                   'american-football',
  'american football':     'american-football',
  // Baseball
  mlb:                     'baseball',
  baseball:                'baseball',
  // Ice Hockey
  nhl:                     'ice-hockey',
  'ice hockey':            'ice-hockey',
  // Tennis
  atp:                     'tennis',
  wta:                     'tennis',
  tennis:                  'tennis',
  // MMA / Combat
  mma:                     'mixed-martial-arts',
  ufc:                     'mixed-martial-arts',
  boxing:                  'boxing',
  // Golf
  pga:                     'golf',
  golf:                    'golf',
  // Other sports on odds-api.io
  darts:                   'darts',
  rugby:                   'rugby',
  cricket:                 'cricket',
  volleyball:              'volleyball',
  lacrosse:                'lacrosse',
  // Soccer — league names and generic
  soccer:                  'football',
  football:                'football',
  mls:                     'football',
  epl:                     'football',
  'premier league':        'football',
  laliga:                  'football',
  'la liga':               'football',
  bundesliga:              'football',
  'serie a':               'football',
  'ligue 1':               'football',
  ucl:                     'football',
  'champions league':      'football',
  'uefa champions league': 'football',
  uel:                     'football',
  'europa league':         'football',
}

// Maps picktheodds sport name → odds-api.io league slug for precise event querying.
// null = no specific league known; fetchEvents will fall back to sport-only.
// Verified against live API on 2026-04-02.
export const ODDS_API_LEAGUE_SLUGS: Record<string, string | null> = {
  // Basketball
  nba:                     'usa-nba',
  ncaab:                   'usa-ncaa-division-i-national-championship',
  wnba:                    null,   // off-season; slug TBD when season starts
  basketball:              null,
  // American Football
  nfl:                     null,   // off-season; slug TBD
  ncaaf:                   null,
  'american football':     null,
  // Baseball
  mlb:                     'usa-mlb',
  baseball:                'usa-mlb',
  // Ice Hockey
  nhl:                     'usa-nhl',
  'ice hockey':            'usa-nhl',
  // Tennis — leagues are dynamic per tournament; always query by sport
  atp:                     null,
  wta:                     null,
  tennis:                  null,
  // MMA / Combat
  mma:                     null,
  ufc:                     null,
  boxing:                  null,
  // Golf
  pga:                     null,
  golf:                    null,
  // Soccer — map specific league names first
  mls:                     'usa-mls',
  epl:                     'england-premier-league',
  'premier league':        'england-premier-league',
  laliga:                  'spain-laliga',
  'la liga':               'spain-laliga',
  bundesliga:              'germany-bundesliga',
  'serie a':               'italy-serie-a',
  'ligue 1':               'france-ligue-1',
  ucl:                     'international-clubs-uefa-champions-league',
  'champions league':      'international-clubs-uefa-champions-league',
  'uefa champions league': 'international-clubs-uefa-champions-league',
  uel:                     'international-clubs-uefa-europa-league',
  'europa league':         'international-clubs-uefa-europa-league',
  // Generic soccer — no single league
  soccer:                  null,
  football:                null,
}

// Priority order for featured markets (ML / Spread / Totals).
// Circa is the sharpest available, then BetOnline.ag, then FanDuel as fallback.
export const SHARP_BOOK_PRIORITY = ['Circa', 'BetOnline.ag', 'FanDuel']

// Priority order for prop markets: FanDuel (best coverage) → Circa → DraftKings.
export const PROP_BOOK_PRIORITY = ['FanDuel', 'Circa', 'DraftKings']

// picktheodds stat type → string that appears in the odds-api.io label parentheses,
// e.g. "Points - Doncic, L" → statType "Points" → label contains "(Points)".
// Verify these against live /odds responses if new stat types appear.
export const PROP_STAT_LABEL_MAP: Record<string, string> = {
  // Basketball — singles
  Points:            'Points',
  Rebounds:          'Rebounds',
  Assists:           'Assists',
  Blocks:            'Blocks',
  Steals:            'Steals',
  Turnovers:         'Turnovers',
  '3-Pointers Made': '3 Point FG',
  '3PT':             '3 Point FG',
  // Basketball — combos (picktheodds format: "Pts + Ast + Reb")
  'Pts + Ast + Reb':  'Pts+Rebs+Asts',
  'Pts + Ast':        'Pts+Asts',
  'Pts + Reb':        'Pts+Rebs',
  'Reb + Ast':        'Rebs+Asts',
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
  // Baseball — pitcher props
  // Label names verified against FanDuel via odds-api.io; update if live responses differ.
  'Pitcher Strikeouts':   'Pitcher Strikeouts',
  'Pitcher Allowed Hits': 'Hits Allowed',
  'Pitcher Earned Runs':  'Earned Runs',
  'Pitcher Walks':        'Walks',
  'Pitcher Earned Outs':  'Outs Recorded',
  'Pitcher Home Runs':    'Home Runs Allowed',
  // Hockey
  Goals:             'Goals',
  Shots:             'Shots on Goal',
  'Shots on Goal':   'Shots on Goal',   // picktheodds may use either "Shots" or "Shots on Goal"
  'Blocked Shots':   'Blocked Shots',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  // NFD decomposition converts accented chars (ć→c+◌́, č→c+◌̌, etc.) then strip combining marks
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatchesName(keyword: string, teamName: string): boolean {
  const kw = normalize(keyword)
  const tn = normalize(teamName)
  return tn === kw || tn.includes(kw) || kw.includes(tn)
}

// Parse odds string (e.g. "1.91") → number, returns null for "N/A" or invalid.
function parseDecimalOdds(val: string | undefined): number | null {
  if (!val || val === 'N/A') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// Decimal odds → American odds
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

// Returns events for a sport (+ optional league) within a time window.
// Used to resolve team names → event IDs.
// Pass leagueSlug when known — it narrows results to one league and removes the need for a limit.
export async function fetchEvents(
  sportSlug: string,
  from: string,
  to: string,
  apiKey: string,
  leagueSlug?: string
): Promise<OddsApiEvent[]> {
  const params = new URLSearchParams({
    apiKey,
    sport: sportSlug,
    from,
    to,
    status: 'pending,live',
  })
  if (leagueSlug) {
    params.set('league', leagueSlug)
  } else {
    // Without a league filter the result set can be large; cap at 200 as a safety net.
    params.set('limit', '200')
  }
  const res = await fetch(`${ODDS_API_IO_BASE}/events?${params}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEvents ${sportSlug}${leagueSlug ? `/${leagueSlug}` : ''} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsApiEvent[]>
}

// Returns full odds (all markets) for a single event from the specified bookmakers.
export async function fetchEventOddsById(
  eventId: number,
  bookmakers: string[],
  apiKey: string
): Promise<OddsApiOddsResponse> {
  const params = new URLSearchParams({
    apiKey,
    eventId: String(eventId),
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

// Returns the soonest matching event for a given matchup.
// When the same two teams appear multiple times (back-to-back games), the earliest date wins.
export function findEvent(events: OddsApiEvent[], team1: string, team2: string): OddsApiEvent | null {
  const matches = events.filter(ev => {
    const hasTeam1 = teamMatchesName(team1, ev.home) || teamMatchesName(team1, ev.away)
    const hasTeam2 = teamMatchesName(team2, ev.home) || teamMatchesName(team2, ev.away)
    return hasTeam1 && hasTeam2
  })
  if (matches.length === 0) return null
  matches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return matches[0]
}

// ── Outcome Extraction ────────────────────────────────────────────────────────

function extractMoneylineOdds(
  event: OddsApiOddsResponse,
  odds: OddsApiOdds,
  betLine: string
): { price: number; opposingPrice: number | null; rawEntry: OddsApiOdds } | null {
  if (betLine.toLowerCase() === 'draw') {
    const p = parseDecimalOdds(odds.draw)
    if (p == null) return null
    return { price: decimalToAmerican(p), opposingPrice: null, rawEntry: odds }
  }
  const isHome = teamMatchesName(betLine, event.home)
  const isAway = teamMatchesName(betLine, event.away)
  const ourVal = isHome ? odds.home : isAway ? odds.away : null
  const oppVal = isHome ? odds.away : isAway ? odds.home : null
  const ourP = parseDecimalOdds(ourVal ?? undefined)
  if (ourP == null) return null
  const oppP = parseDecimalOdds(oppVal ?? undefined)
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null, rawEntry: odds }
}

function extractSpreadOdds(
  event: OddsApiOddsResponse,
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null; rawEntry: OddsApiOdds } | null {
  const parsed = parseSpreadLine(betLine)
  if (!parsed) return null

  const betIsHome = teamMatchesName(parsed.teamKeyword, event.home)
  const betIsAway = teamMatchesName(parsed.teamKeyword, event.away)
  if (!betIsHome && !betIsAway) return null

  // hdp = home team's handicap (e.g. -2 means home is -2 favorite).
  // If bet is on home at -2: targetHdp = -2, price = entry.home.
  // If bet is on away at +2: home's hdp = -2, targetHdp = -parsed.spread = -2, price = entry.away.
  const targetHdp = betIsHome ? parsed.spread : -parsed.spread
  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - targetHdp) < 0.1)
  if (!entry) return null

  const ourP = parseDecimalOdds(betIsHome ? entry.home : entry.away)
  const oppP = parseDecimalOdds(betIsHome ? entry.away : entry.home)
  if (ourP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null, rawEntry: entry }
}

function extractTotalOdds(
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null; rawEntry: OddsApiOdds } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const totalValue = parseFloat(m[2])

  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - totalValue) < 0.1)
  if (!entry) return null

  const ourP = parseDecimalOdds(direction === 'over' ? entry.over : entry.under)
  const oppP = parseDecimalOdds(direction === 'over' ? entry.under : entry.over)
  if (ourP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null, rawEntry: entry }
}

// Props label format: "Paolo Banchero (Points)" — match by lastName + stat type in parens.
function extractPropOdds(
  oddsArr: OddsApiOdds[],
  lastName: string,
  statLabelStr: string,  // e.g. "Points" (the parentheses content to match)
  betLine: string
): { price: number; opposingPrice: number | null; rawEntry: OddsApiOdds } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const lineValue = parseFloat(m[2])
  const lastNameNorm = normalize(lastName)
  const statNorm = normalize(statLabelStr)

  const entry = oddsArr.find(o => {
    if (!o.label) return false
    if (o.hdp == null || Math.abs(o.hdp - lineValue) >= 0.1) return false
    const labelNorm = normalize(o.label)
    // Label format: "firstname lastname (stat type)" — check lastName and stat type
    const parenMatch = o.label.match(/\(([^)]+)\)$/)
    if (!parenMatch) return false
    const labelStat = normalize(parenMatch[1])
    return labelNorm.includes(lastNameNorm) && labelStat === statNorm
  })
  if (!entry) {
    // Log a sample of available labels (first 5 at this hdp) to aid debugging
    const atHdp = oddsArr.filter(o => o.hdp != null && Math.abs(o.hdp - lineValue) < 0.1)
    const sampleLabels = atHdp.slice(0, 5).map(o => o.label ?? '(no label)')
    console.warn(
      `[odds-api] extractPropOdds no match: lastName="${lastName}" norm="${lastNameNorm}" stat="${statLabelStr}" hdp=${lineValue}; ` +
      `${atHdp.length} entries at that hdp. Sample labels: ${JSON.stringify(sampleLabels)}`
    )
    return null
  }

  const ourP = parseDecimalOdds(direction === 'over' ? entry.over : entry.under)
  const oppP = parseDecimalOdds(direction === 'over' ? entry.under : entry.over)
  // Require both sides — one-sided prop odds can't be de-vigged.
  if (ourP == null || oppP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: decimalToAmerican(oppP), rawEntry: entry }
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

function isFeaturedMarket(market: string): boolean {
  // Player props always contain " - " (e.g. "Total Bases - Soto, J"); exclude them first.
  if (market.includes(' - ')) return false
  return market === 'Moneyline' || market === 'Spread' || market === 'Total' || market.startsWith('Total ')
}

function extractFeaturedOddsFromBookmaker(
  event: OddsApiOddsResponse,
  markets: OddsApiMarket[],
  bet: Bet
): { price: number; opposingPrice: number | null; rawEntry: OddsApiOdds } | null {
  const market = bet.market!
  const line = bet.line!

  if (market === 'Moneyline') {
    const mkt = markets.find(m => m.name === 'ML')
    if (!mkt || mkt.odds.length === 0) return null
    return extractMoneylineOdds(event, mkt.odds[0], line)
  }

  if (market === 'Spread') {
    const mkt = markets.find(m => m.name === 'Spread')
    if (!mkt) return null
    return extractSpreadOdds(event, mkt.odds, line)
  }

  if (market === 'Total' || market.startsWith('Total ')) {
    const mkt = markets.find(m => m.name === 'Totals')
    if (!mkt) return null
    return extractTotalOdds(mkt.odds, line)
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

  // ── Player props: FanDuel → Circa → DraftKings ──────────────────────────────
  if (!isFeaturedMarket(bet.market)) {
    const parsed = parsePropMarketStr(bet.market)
    if (!parsed) {
      console.warn(`[odds-api] Cannot parse prop market: "${bet.market}" (bet ${bet.id})`)
      return null
    }
    const statLabel = PROP_STAT_LABEL_MAP[parsed.statType]
    if (!statLabel) {
      console.warn(`[odds-api] Unsupported prop stat type: "${parsed.statType}" (bet ${bet.id})`)
      return null
    }
    for (const bookName of PROP_BOOK_PRIORITY) {
      const bmMarkets = oddsResp.bookmakers[bookName]
      if (!bmMarkets) continue
      const propMkt = bmMarkets.find(m => m.name === 'Player Props')
      if (!propMkt) continue
      const result = extractPropOdds(propMkt.odds, parsed.lastName, statLabel, bet.line)
      if (result) return { ...result, bookKey: bookName }
    }
    console.warn(`[odds-api] No prop odds found for bet ${bet.id} (${bet.market})`)
    return null
  }

  // ── Featured markets: Circa → BetOnline.ag → FanDuel ────────────────────────
  // Require both sides (opposingPrice != null) so de-vig is accurate.
  // Draw moneylines are exempt — they're 3-way markets with no single opposing side.
  const isDraw = bet.line?.toLowerCase() === 'draw'
  const bookOrder = [
    ...SHARP_BOOK_PRIORITY,
    ...Object.keys(oddsResp.bookmakers).filter(n => !SHARP_BOOK_PRIORITY.includes(n)),
  ]

  for (const bookName of bookOrder) {
    const bmMarkets = oddsResp.bookmakers[bookName]
    if (!bmMarkets) continue

    const result = extractFeaturedOddsFromBookmaker(oddsResp, bmMarkets, bet)
    if (!result) continue
    if (result.opposingPrice == null && !isDraw) continue  // one-sided data — skip this book
    return { ...result, bookKey: bookName }
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
