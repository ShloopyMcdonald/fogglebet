#!/usr/bin/env node
// One-time fix: remove book_odds entries that appear on both legs of an arb
// with identical odds values (caused by the index-based fallback bug).
//
// Detection: book X has the same odds value in both legs of the same arb_id.
// Fix:       use sign heuristic — a positive book odds belongs on the leg
//            with positive own odds; negative belongs on the negative leg.
//
// Run: node tasks/fix-duplicate-book-odds.js
// Dry run (no writes): node tasks/fix-duplicate-book-odds.js --dry-run

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, '../web/.env.local')
const envVars = {}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim()
}

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL']
const SUPABASE_KEY = envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY']
const DRY_RUN = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials in web/.env.local')
  process.exit(1)
}

console.log(DRY_RUN ? '[DRY RUN] No writes will be made.' : '[LIVE] Will write changes to Supabase.')

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

async function fetchAllBets() {
  const url = `${SUPABASE_URL}/rest/v1/bets?select=id,arb_id,odds,book,book_odds&book_odds=not.is.null&order=recorded_at.asc`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function updateBet(id, bookOdds) {
  const url = `${SUPABASE_URL}/rest/v1/bets?id=eq.${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ book_odds: bookOdds }),
  })
  if (!res.ok) throw new Error(`Update failed for ${id}: ${res.status} ${await res.text()}`)
}

function getOddsFromBookEntry(entry) {
  // entry shape: { "side label": { odds: N, liquidity?: N } }
  const inner = Object.values(entry)[0]
  return typeof inner?.odds === 'number' ? inner.odds : undefined
}

async function main() {
  const bets = await fetchAllBets()
  console.log(`Fetched ${bets.length} bets with book_odds.`)

  // Group by arb_id
  const groups = {}
  for (const bet of bets) {
    if (!groups[bet.arb_id]) groups[bet.arb_id] = []
    groups[bet.arb_id].push(bet)
  }

  let pairsChecked = 0
  let pairsFixed = 0
  let totalBooksRemoved = 0

  for (const [arbId, pair] of Object.entries(groups)) {
    if (pair.length !== 2) continue
    pairsChecked++

    const [a, b] = pair

    const booksA = Object.keys(a.book_odds)
    const booksB = Object.keys(b.book_odds)
    const commonBooks = booksA.filter(book => booksB.includes(book))

    const aFixed = { ...a.book_odds }
    const bFixed = { ...b.book_odds }
    let aChanged = false
    let bChanged = false

    for (const book of commonBooks) {
      // Never remove the leg's own book (taken book)
      if (book === a.book || book === b.book) continue

      const aOddsVal = getOddsFromBookEntry(a.book_odds[book])
      const bOddsVal = getOddsFromBookEntry(b.book_odds[book])

      if (aOddsVal === undefined || bOddsVal === undefined) continue
      if (aOddsVal !== bOddsVal) continue  // Different odds = legitimate dual-sided entry

      // Same odds on both legs — determine which to keep using sign heuristic.
      // Positive book odds belong on the positive-odds leg; negative on negative.
      const aIsPositive = a.odds > 0
      const bIsPositive = b.odds > 0

      if (aIsPositive === bIsPositive) {
        // Both legs same sign — can't reliably determine (unusual arb); skip.
        console.warn(`  [SKIP] arb ${arbId} — both legs same odds sign, book=${book}, odds=${aOddsVal}`)
        continue
      }

      const bookIsPositive = aOddsVal > 0
      let removeFrom

      if (bookIsPositive) {
        // Keep on positive-odds leg, remove from negative-odds leg
        removeFrom = aIsPositive ? b : a
        if (aIsPositive) { delete bFixed[book]; bChanged = true }
        else              { delete aFixed[book]; aChanged = true }
      } else {
        // Keep on negative-odds leg, remove from positive-odds leg
        if (aIsPositive) { delete aFixed[book]; aChanged = true }
        else              { delete bFixed[book]; bChanged = true }
      }

      console.log(
        `  [FIX] arb ${arbId} — remove "${book}" (odds ${aOddsVal > 0 ? '+' : ''}${aOddsVal}) ` +
        `from leg ${aIsPositive && !bookIsPositive || !aIsPositive && bookIsPositive ? a.id : b.id} ` +
        `(${aIsPositive && !bookIsPositive || !aIsPositive && bookIsPositive ? `+${a.odds} ${a.book}` : `${b.odds > 0 ? '+' : ''}${b.odds} ${b.book}`})`
      )
      totalBooksRemoved++
    }

    if (aChanged || bChanged) {
      pairsFixed++
      if (!DRY_RUN) {
        if (aChanged) await updateBet(a.id, aFixed)
        if (bChanged) await updateBet(b.id, bFixed)
      }
    }
  }

  console.log(`\nDone. Checked ${pairsChecked} arb pairs, fixed ${pairsFixed}, removed ${totalBooksRemoved} duplicate book entries.`)
  if (DRY_RUN && pairsFixed > 0) {
    console.log('Re-run without --dry-run to apply changes.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
