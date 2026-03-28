import { Bet } from './supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EspnTeam {
  displayName: string
  shortDisplayName: string
  abbreviation: string
}

interface EspnCompetitor {
  homeAway: 'home' | 'away'
  score: string
  team: EspnTeam
}

interface EspnCompetition {
  status: {
    type: {
      name: string       // "STATUS_FINAL", "STATUS_IN_PROGRESS", etc.
      completed: boolean
      state: string      // "pre" | "in" | "post"
    }
  }
  competitors: EspnCompetitor[]
}

export interface EspnGame {
  id: string
  name: string  // "Golden State Warriors vs Boston Celtics"
  date: string
  competitions: EspnCompetition[]
}

interface EspnScoreboard {
  events?: EspnGame[]
}

interface EspnAthleteStats {
  athlete: { displayName: string; shortName: string }
  stats: string[]
}

interface EspnStatGroup {
  names: string[]
  athletes: EspnAthleteStats[]
}

interface EspnPlayerStats {
  team: { displayName: string }
  statistics: EspnStatGroup[]
}

export interface EspnSummary {
  boxscore?: {
    players?: EspnPlayerStats[]
  }
}

export type BetOutcome = 'win' | 'loss' | 'push'

// ── Constants ─────────────────────────────────────────────────────────────────

export const ESPN_SPORT_MAP: Record<string, { sport: string; league: string }> = {
  NBA:   { sport: 'basketball', league: 'nba' },
  NFL:   { sport: 'football',   league: 'nfl' },
  MLB:   { sport: 'baseball',   league: 'mlb' },
  NHL:   { sport: 'hockey',     league: 'nhl' },
  NCAAB: { sport: 'basketball', league: 'mens-college-basketball' },
  NCAAF: { sport: 'football',   league: 'college-football' },
  WNBA:  { sport: 'basketball', league: 'wnba' },
}

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// Maps our market stat prefix to ESPN box score column name(s)
const STAT_NAME_MAP: Record<string, string[]> = {
  // Basketball
  Points:             ['PTS'],
  Rebounds:           ['REB'],
  Assists:            ['AST'],
  Blocks:             ['BLK'],
  Steals:             ['STL'],
  Turnovers:          ['TO'],
  '3-Pointers Made':  ['3PT'],
  // Baseball
  Strikeouts:         ['SO', 'K'],
  Hits:               ['H'],
  'Home Runs':        ['HR'],
  RBIs:               ['RBI'],
  'Total Bases':      ['TB'],
  Runs:               ['R'],
  // Football
  'Receiving Yards':  ['YDS'],
  Receptions:         ['REC'],
  'Receiving TDs':    ['TD'],
  'Rush Yards':       ['YDS'],
  'Rushing TDs':      ['TD'],
  'Pass Yards':       ['YDS', 'PYDS'],
  'Pass TDs':         ['TD'],
  Interceptions:      ['INT'],
  // Hockey
  Goals:              ['G'],
  Shots:              ['S', 'SOG'],
}

// ── Date Helpers ──────────────────────────────────────────────────────────────

// Convert UTC ISO string to YYYYMMDD in approximate ET (UTC-5)
export function toEtDateStr(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() - 5 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function prevDateStr(dateStr: string): string {
  const y = parseInt(dateStr.slice(0, 4))
  const mo = parseInt(dateStr.slice(4, 6)) - 1
  const d = parseInt(dateStr.slice(6, 8))
  const prev = new Date(Date.UTC(y, mo, d - 1))
  return (
    String(prev.getUTCFullYear()) +
    String(prev.getUTCMonth() + 1).padStart(2, '0') +
    String(prev.getUTCDate()).padStart(2, '0')
  )
}

// ── API Fetching ──────────────────────────────────────────────────────────────

export async function fetchScoreboard(
  sport: string,
  league: string,
  gameTimeUtc: string
): Promise<EspnGame[]> {
  const dateStr = toEtDateStr(gameTimeUtc)
  const prev = prevDateStr(dateStr)
  const urls = [
    `${ESPN_BASE}/${sport}/${league}/scoreboard?dates=${dateStr}&limit=100`,
    `${ESPN_BASE}/${sport}/${league}/scoreboard?dates=${prev}&limit=100`,
  ]

  const results = await Promise.all(
    urls.map(url =>
      fetch(url, { cache: 'no-store' })
        .then(r => r.json() as Promise<EspnScoreboard>)
        .catch(err => { console.warn('[espn] scoreboard fetch failed:', url, err); return {} as EspnScoreboard })
    )
  )

  // Deduplicate by game ID (same game can appear in both date queries)
  const seen = new Set<string>()
  const games: EspnGame[] = []
  for (const res of results) {
    for (const ev of res.events ?? []) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id)
        games.push(ev)
      }
    }
  }
  return games
}

export async function fetchGameSummary(
  sport: string,
  league: string,
  eventId: string
): Promise<EspnSummary> {
  const url = `${ESPN_BASE}/${sport}/${league}/summary?event=${eventId}`
  return fetch(url, { cache: 'no-store' })
    .then(r => r.json() as Promise<EspnSummary>)
    .catch(err => { console.warn('[espn] summary fetch failed:', url, err); return {} })
}

// ── Team Matching ─────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatches(espnTeam: EspnTeam, keyword: string): boolean {
  const kw = normalize(keyword)
  if (!kw) return false
  const dn = normalize(espnTeam.displayName)
  const sdn = normalize(espnTeam.shortDisplayName)
  const abbr = normalize(espnTeam.abbreviation)
  return (
    dn === kw || dn.includes(kw) || kw.includes(dn) ||
    sdn === kw || sdn.includes(kw) || kw.includes(sdn) ||
    abbr === kw
  )
}

export function parseTeamsFromBetName(betName: string): [string, string] | null {
  // bet_name format: "team1 vs team2 — market — sideLabel"
  const firstSegment = betName.split(' \u2014 ')[0] // before first em-dash
  const vsParts = firstSegment.split(' vs ')
  if (vsParts.length < 2) return null
  return [vsParts[0].trim(), vsParts.slice(1).join(' vs ').trim()]
}

export function findGame(games: EspnGame[], team1: string, team2: string): EspnGame | null {
  for (const game of games) {
    const comp = game.competitions[0]
    if (!comp || comp.competitors.length < 2) continue
    const { competitors } = comp
    const hasTeam1 = competitors.some(c => teamMatches(c.team, team1))
    const hasTeam2 = competitors.some(c => teamMatches(c.team, team2))
    if (hasTeam1 && hasTeam2) return game
  }
  return null
}

function findCompetitor(competitors: EspnCompetitor[], keyword: string): EspnCompetitor | null {
  return competitors.find(c => teamMatches(c.team, keyword)) ?? null
}

// ── Line Parsing ──────────────────────────────────────────────────────────────

// line = "Warriors -3" or "CHI+34.5" → { teamKeyword: "Warriors", spread: -3 }
function parseSpreadLine(line: string): { teamKeyword: string; spread: number } | null {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  if (isNaN(spread)) return null
  return { teamKeyword: m[1].trim(), spread }
}

// line = "Over 200.5" or "Under 180.5" → { direction: "over"|"under", threshold: 200.5 }
function parseOverUnderLine(line: string): { direction: 'over' | 'under'; threshold: number } | null {
  const m = line.match(/^(Over|Under)\s+([\d.]+)$/i)
  if (!m) return null
  const threshold = parseFloat(m[2])
  if (isNaN(threshold)) return null
  return { direction: m[1].toLowerCase() as 'over' | 'under', threshold }
}

// ── Player Prop Resolution ────────────────────────────────────────────────────

// market: "Points - Doncic, L" → { statType: "Points", lastName: "Doncic", firstInitial: "L" }
function parsePlayerMarket(market: string): { statType: string; lastName: string; firstInitial: string } | null {
  const dashIdx = market.indexOf(' - ')
  if (dashIdx === -1) return null
  const statType = market.slice(0, dashIdx).trim()
  const playerPart = market.slice(dashIdx + 3).trim() // "Doncic, L"
  const commaIdx = playerPart.indexOf(',')
  if (commaIdx === -1) {
    // No comma — just a last name
    return { statType, lastName: playerPart, firstInitial: '' }
  }
  return {
    statType,
    lastName: playerPart.slice(0, commaIdx).trim(),
    firstInitial: playerPart.slice(commaIdx + 1).trim(),
  }
}

function resolvePlayerProp(
  market: string,
  line: string,
  summary: EspnSummary
): BetOutcome | null {
  const parsed = parsePlayerMarket(market)
  if (!parsed) return null

  const { statType, lastName, firstInitial } = parsed
  const statCols = STAT_NAME_MAP[statType]
  if (!statCols || statCols.length === 0) {
    console.warn(`[espn] No stat mapping for: ${statType}`)
    return null
  }

  const overUnder = parseOverUnderLine(line)
  if (!overUnder) return null
  const { direction, threshold } = overUnder

  const lastNorm = normalize(lastName)

  for (const teamStats of summary.boxscore?.players ?? []) {
    for (const group of teamStats.statistics) {
      // Find the stat column index (use first match from our list)
      let colIdx = -1
      for (const col of statCols) {
        const idx = group.names.indexOf(col)
        if (idx !== -1) { colIdx = idx; break }
      }
      if (colIdx === -1) continue

      for (const entry of group.athletes) {
        const dn = normalize(entry.athlete.displayName)
        const sn = normalize(entry.athlete.shortName)

        if (!dn.includes(lastNorm) && !sn.includes(lastNorm)) continue

        // Optionally confirm first initial
        if (firstInitial) {
          const fi = normalize(firstInitial)
          const fiMatch = dn.startsWith(fi) || sn.startsWith(fi) ||
            dn.includes(' ' + fi) || sn.includes(' ' + fi)
          if (!fiMatch) continue
        }

        const rawStat = entry.stats[colIdx]
        if (!rawStat || rawStat === '--') return null

        // Handle "5-12" format (e.g., 3PT made-attempted): take first number
        const statValue = parseFloat(rawStat.split('-')[0])
        if (isNaN(statValue)) return null

        if (direction === 'over') {
          if (statValue > threshold) return 'win'
          if (statValue < threshold) return 'loss'
          return 'push'
        } else {
          if (statValue < threshold) return 'win'
          if (statValue > threshold) return 'loss'
          return 'push'
        }
      }
    }
  }

  console.warn(`[espn] Player not found in box score: ${lastName}, ${firstInitial}`)
  return null
}

// ── Result Determination ──────────────────────────────────────────────────────

export function determineResult(
  bet: Bet,
  game: EspnGame,
  summary: EspnSummary | null
): BetOutcome | null {
  const comp = game.competitions[0]
  if (!comp || !comp.status.type.completed) return null

  const { competitors } = comp
  if (competitors.length < 2) return null

  const market = bet.market ?? ''
  const line = bet.line ?? ''

  if (!line) {
    console.warn(`[espn] No line for bet: ${bet.id}`)
    return null
  }

  // ── Moneyline ──────────────────────────────────────────────────────────────
  // line = team name, e.g. "Warriors"
  if (market === 'Moneyline') {
    const betComp = findCompetitor(competitors, line)
    if (!betComp) return null
    const oppComp = competitors.find(c => c !== betComp)
    if (!oppComp) return null
    const betScore = parseInt(betComp.score)
    const oppScore = parseInt(oppComp.score)
    if (isNaN(betScore) || isNaN(oppScore)) return null
    if (betScore > oppScore) return 'win'
    if (betScore < oppScore) return 'loss'
    return 'push'
  }

  // ── Spread ─────────────────────────────────────────────────────────────────
  // line = "Warriors -3" or "CHI+34.5"
  if (market === 'Spread') {
    const parsed = parseSpreadLine(line)
    if (!parsed) return null
    const betComp = findCompetitor(competitors, parsed.teamKeyword)
    if (!betComp) return null
    const oppComp = competitors.find(c => c !== betComp)
    if (!oppComp) return null
    const betScore = parseInt(betComp.score)
    const oppScore = parseInt(oppComp.score)
    if (isNaN(betScore) || isNaN(oppScore)) return null
    const diff = betScore - oppScore + parsed.spread
    if (diff > 0) return 'win'
    if (diff < 0) return 'loss'
    return 'push'
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  // line = "Over 200.5" or "Under 180.5"
  if (market === 'Total') {
    const parsed = parseOverUnderLine(line)
    if (!parsed) return null
    const score1 = parseInt(competitors[0].score)
    const score2 = parseInt(competitors[1].score)
    if (isNaN(score1) || isNaN(score2)) return null
    const total = score1 + score2
    if (parsed.direction === 'over') {
      if (total > parsed.threshold) return 'win'
      if (total < parsed.threshold) return 'loss'
      return 'push'
    } else {
      if (total < parsed.threshold) return 'win'
      if (total > parsed.threshold) return 'loss'
      return 'push'
    }
  }

  // ── Player Props ───────────────────────────────────────────────────────────
  // market = "Points - Doncic, L", line = "Over 33.5"
  if (market.includes(' - ')) {
    if (!summary) return null
    return resolvePlayerProp(market, line, summary)
  }

  console.warn(`[espn] Unknown market: ${market} for bet ${bet.id}`)
  return null
}

// ── P&L ───────────────────────────────────────────────────────────────────────

export function calcProfitLoss(result: BetOutcome, odds: number, stake: number): number {
  if (result === 'win') {
    return odds > 0
      ? stake * (odds / 100)
      : stake * (100 / Math.abs(odds))
  }
  if (result === 'loss') return -stake
  return 0 // push
}
