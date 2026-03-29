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
  linescores?: Array<{ value: number }>
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
  names?: string[]    // NBA (and MLB batting/pitching)
  keys?: string[]     // NHL, MLB (semantic camelCase keys)
  labels?: string[]   // NHL (short display labels)
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
  // Basketball
  NBA:   { sport: 'basketball', league: 'nba' },
  NCAAB: { sport: 'basketball', league: 'mens-college-basketball' },
  WNBA:  { sport: 'basketball', league: 'wnba' },
  // Football
  NFL:   { sport: 'football', league: 'nfl' },
  NCAAF: { sport: 'football', league: 'college-football' },
  // Baseball
  MLB:   { sport: 'baseball', league: 'mlb' },
  // Hockey
  NHL:   { sport: 'hockey', league: 'nhl' },
  // Soccer
  MLS:                     { sport: 'soccer', league: 'usa.1' },
  NWSL:                    { sport: 'soccer', league: 'usa.nwsl' },
  EPL:                     { sport: 'soccer', league: 'eng.1' },
  'PREMIER LEAGUE':        { sport: 'soccer', league: 'eng.1' },
  LALIGA:                  { sport: 'soccer', league: 'esp.1' },
  'LA LIGA':               { sport: 'soccer', league: 'esp.1' },
  BUNDESLIGA:              { sport: 'soccer', league: 'ger.1' },
  'SERIE A':               { sport: 'soccer', league: 'ita.1' },
  'LIGUE 1':               { sport: 'soccer', league: 'fra.1' },
  UCL:                     { sport: 'soccer', league: 'uefa.champions' },
  'CHAMPIONS LEAGUE':      { sport: 'soccer', league: 'uefa.champions' },
  'UEFA CHAMPIONS LEAGUE': { sport: 'soccer', league: 'uefa.champions' },
  UEL:                     { sport: 'soccer', league: 'uefa.europa' },
  'EUROPA LEAGUE':         { sport: 'soccer', league: 'uefa.europa' },
  // Tennis
  ATP: { sport: 'tennis', league: 'atp' },
  WTA: { sport: 'tennis', league: 'wta' },
}

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// Maps our market stat prefix to ESPN box score column name(s).
// Column names are matched against group.names ?? group.labels ?? group.keys.
const STAT_NAME_MAP: Record<string, string[]> = {
  // Basketball — full stat names
  Points:             ['PTS'],
  Rebounds:           ['REB'],
  Assists:            ['AST', 'A'],  // 'AST' for NBA, 'A' for NHL
  Blocks:             ['BLK'],
  Steals:             ['STL'],
  Turnovers:          ['TO'],
  '3-Pointers Made':  ['3PT'],
  // Basketball — abbreviated forms used in combo prop markets ("Pts + Ast + Reb")
  'Pts':              ['PTS'],
  'Reb':              ['REB'],
  'Ast':              ['AST', 'A'],
  'Blk':              ['BLK'],
  'Stl':              ['STL'],
  // 3PT shorthand used in market names like "3PT - Monk, M"
  '3PT':              ['3PT'],
  // Baseball — batter props
  Strikeouts:         ['SO', 'K'],
  Hits:               ['H'],
  'Home Runs':        ['HR'],
  RBIs:               ['RBI'],
  // 'Total Bases' not computable from ESPN box score (no 2B/3B columns)
  'Total Bases':      ['TB'],
  Runs:               ['R'],
  // Baseball — pitcher props (market prefix "Pitcher ...")
  'Pitcher Strikeouts':   ['K'],
  'Pitcher Allowed Hits': ['H'],
  'Pitcher Earned Runs':  ['ER'],
  'Pitcher Walks':        ['BB'],
  'Pitcher Home Runs':    ['HR'],
  // Pitcher Earned Outs: ESPN stores IP as "X.Y" (e.g. "6.0" = 6 innings).
  // resolvePlayerProp detects the 'IP' column and converts to outs (X*3+Y).
  'Pitcher Earned Outs':  ['IP'],
  // Football
  'Receiving Yards':  ['YDS'],
  Receptions:         ['REC'],
  'Receiving TDs':    ['TD'],
  'Rush Yards':       ['YDS'],
  'Rushing TDs':      ['TD'],
  'Pass Yards':       ['YDS', 'PYDS'],
  'Pass TDs':         ['TD'],
  Interceptions:      ['INT'],
  // Hockey — NHL box score uses 'labels' field (no 'names'); columns below are NHL labels
  Goals:              ['G'],
  'Shots on Goal':    ['S'],   // shotsTotal in NHL labels
  'Blocked Shots':    ['BS'],  // blockedShots in NHL labels
  'Shots Saved':      ['SV'],  // goalie saves in NHL labels
  Shots:              ['S'],
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

// Return the column-name array for a stat group, handling all ESPN API variants:
// - NBA uses 'names' (e.g. ['MIN','PTS','REB',...])
// - NHL uses 'labels' only (no 'names')
// - MLB has both 'names' and 'labels' (they are identical)
function groupColNames(group: EspnStatGroup): string[] {
  return group.names ?? group.labels ?? group.keys ?? []
}

// Compare a stat value to an over/under threshold
function compareToLine(value: number, direction: 'over' | 'under', threshold: number): BetOutcome {
  if (direction === 'over') {
    if (value > threshold) return 'win'
    if (value < threshold) return 'loss'
    return 'push'
  } else {
    if (value < threshold) return 'win'
    if (value > threshold) return 'loss'
    return 'push'
  }
}

// Look up a single stat column index in a group; returns -1 if not found
function findColIdx(group: EspnStatGroup, statCols: string[]): number {
  const names = groupColNames(group)
  for (const col of statCols) {
    const idx = names.indexOf(col)
    if (idx !== -1) return idx
  }
  return -1
}

// Parse a raw stat value from the box score.
// Handles "made-attempted" formats like "3-7" (takes made count),
// and IP "X.Y" format for 'Pitcher Earned Outs' (converts to outs).
function parseStatValue(raw: string, statCols: string[]): number {
  if (!raw || raw === '--') return NaN

  // IP → outs conversion: "6.0"=18 outs, "5.2"=17 outs, "4.1"=13 outs
  if (statCols.some(c => c === 'IP')) {
    const ipMatch = raw.match(/^(\d+)\.([012])$/)
    if (ipMatch) {
      return parseInt(ipMatch[1]) * 3 + parseInt(ipMatch[2])
    }
  }

  // "made-attempted" format (e.g. 3PT "3-7") → take first number
  return parseFloat(raw.split('-')[0])
}

function resolvePlayerProp(
  market: string,
  line: string,
  summary: EspnSummary
): BetOutcome | null {
  const parsed = parsePlayerMarket(market)
  if (!parsed) return null

  const { statType, lastName, firstInitial } = parsed

  const overUnder = parseOverUnderLine(line)
  if (!overUnder) return null
  const { direction, threshold } = overUnder

  const lastNorm = normalize(lastName)

  // ── Combo props (e.g. "Pts + Ast + Reb", "Pts + Ast") ──────────────────────
  if (statType.includes(' + ')) {
    const parts = statType.split(' + ').map(p => p.trim())

    for (const teamStats of summary.boxscore?.players ?? []) {
      for (const group of teamStats.statistics) {
        // Ensure ALL combo parts have a column in this group
        const colIndices: number[] = []
        let allFound = true
        for (const part of parts) {
          const statCols = STAT_NAME_MAP[part]
          if (!statCols) { allFound = false; break }
          const idx = findColIdx(group, statCols)
          if (idx === -1) { allFound = false; break }
          colIndices.push(idx)
        }
        if (!allFound) continue

        for (const entry of group.athletes) {
          const dn = normalize(entry.athlete.displayName)
          const sn = normalize(entry.athlete.shortName)
          if (!dn.includes(lastNorm) && !sn.includes(lastNorm)) continue

          if (firstInitial) {
            const fi = normalize(firstInitial)
            const fiMatch = dn.startsWith(fi) || sn.startsWith(fi) ||
              dn.includes(' ' + fi) || sn.includes(' ' + fi)
            if (!fiMatch) continue
          }

          let total = 0
          for (const colIdx of colIndices) {
            const raw = entry.stats[colIdx]
            const val = parseStatValue(raw, [])
            if (isNaN(val)) return null
            total += val
          }
          return compareToLine(total, direction, threshold)
        }
      }
    }

    console.warn(`[espn] Player not found for combo prop: ${lastName}, ${firstInitial}`)
    return null
  }

  // ── Single-stat prop ────────────────────────────────────────────────────────
  const statCols = STAT_NAME_MAP[statType]
  if (!statCols || statCols.length === 0) {
    console.warn(`[espn] No stat mapping for: ${statType}`)
    return null
  }

  for (const teamStats of summary.boxscore?.players ?? []) {
    for (const group of teamStats.statistics) {
      const colIdx = findColIdx(group, statCols)
      if (colIdx === -1) continue

      for (const entry of group.athletes) {
        const dn = normalize(entry.athlete.displayName)
        const sn = normalize(entry.athlete.shortName)

        if (!dn.includes(lastNorm) && !sn.includes(lastNorm)) continue

        if (firstInitial) {
          const fi = normalize(firstInitial)
          const fiMatch = dn.startsWith(fi) || sn.startsWith(fi) ||
            dn.includes(' ' + fi) || sn.includes(' ' + fi)
          if (!fiMatch) continue
        }

        const statValue = parseStatValue(entry.stats[colIdx], statCols)
        if (isNaN(statValue)) return null

        return compareToLine(statValue, direction, threshold)
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
  // line = team name, e.g. "Warriors", or "Draw" for soccer 3-way markets
  if (market === 'Moneyline') {
    if (normalize(line) === 'draw') {
      const s1 = parseInt(competitors[0].score)
      const s2 = parseInt(competitors[1].score)
      if (isNaN(s1) || isNaN(s2)) return null
      return s1 === s2 ? 'win' : 'loss'
    }
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
  // market = "Total" | "Total Points" | "Total Points 1H" | "Total Runs" | etc.
  // line = "Over 200.5" or "Under 180.5"
  if (market === 'Total' || /^Total /.test(market)) {
    const parsed = parseOverUnderLine(line)
    if (!parsed) return null

    // First-half totals require period linescores
    const isFirstHalf = /\b1H\b/.test(market)
    let score1: number
    let score2: number

    if (isFirstHalf) {
      const ls0 = competitors[0].linescores
      const ls1 = competitors[1].linescores
      score1 = (ls0?.[0]?.value ?? NaN) + (ls0?.[1]?.value ?? NaN)
      score2 = (ls1?.[0]?.value ?? NaN) + (ls1?.[1]?.value ?? NaN)
    } else {
      score1 = parseInt(competitors[0].score)
      score2 = parseInt(competitors[1].score)
    }

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
