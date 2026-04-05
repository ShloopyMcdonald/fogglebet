# FoggleBet — Lessons Learned

_Permanent log of bugs, corrections, and decisions. Updated after every user correction._

---

## PTO NBA game_time is ~10 min after actual scheduled start; odds-api.io goes live at scheduled start

**Bug:** NBA CLV was never captured. PTO stores game_time as ~10 minutes after the actual scheduled start (e.g. game at 19:00 UTC → PTO stores 19:10). odds-api.io transitions games from "pending" to "live" at the actual scheduled start (19:00), and live/settled games return `bookmakers: {}`. With a 12-min pre-game window, the cron first became eligible at `19:10 - 12min = 18:58` — only a 2-minute window before the game went live at 19:00. NHL had a 6-minute window (game_time offset ~6 min); MLB aligned closely. The narrow NBA window was nearly impossible to hit.

**Fix:** NBA pre-game window increased to 25 min (15-min buffer before actual start), NHL to 20 min.

**Key fact:** Live AND settled games both return `bookmakers: {}` on odds-api.io. Closing odds must be captured while game status is still "pending".

---

## isFeaturedMarket misclassified "Total Bases" and other "Total *" player props

**Bug:** `isFeaturedMarket` used `market.startsWith('Total ')` to detect game totals. This matched player prop markets like `"Total Bases - Soto, J"`, routing them to the game-totals handler which returned null. Every Total Bases bet had null CLV.

**Fix:** Check `market.includes(' - ')` first — player props always contain this delimiter, game totals never do.

---

## ESPN tennis API has a completely different structure from team sports

**Bug:** ATP/WTA were in `ESPN_SPORT_MAP` but tennis results all stayed `pending` because the results cron assumed the team-sport scoreboard structure.

**Root cause:** ESPN tennis scoreboard returns **tournament** objects in `events[]`, not individual matches. Each match is nested under `event.groupings[].competitions[]`. Competitors use `competitor.athlete.displayName` (not `competitor.team.displayName`) and results are determined by `competitor.winner: boolean` (no `score` string exists).

**Fix:** Added `fetchTennisMatches()` to flatten tournament → groupings → competitions, `findTennisMatch()` to match by athlete name, and `determineTennisResult()` using the `winner` boolean. Results cron branches on `mapping.sport === 'tennis'` to use this path.

---

## Spread bet odds are swapped when two arb books differ in side order

**Bug:** `scrapeBookOdds` mapped `btn[sideIdx]` → `sideLabels[sideIdx]`, where `sideLabels` came from leg display order. But the expanded table's buttons are in game-team order (team listed first in the game header = btn[0]), which often differs from leg order.

**Fix:** Extract `sideLine` (e.g. "+32.5", "-3.5") from the sibling of `span.MuiTypography-body3` inside each leg `<a>`. In `scrapeBookOdds`, read cell 0's `div[aria-label]` elements (e.g. `"CHI+32.5"`, `"OKC-32.5"`) — these encode the table's button order. Match their lines to `sideLines` to build `orderedSideLabels` before the button-mapping loop.

**Key DOM facts:**
- Cell 0 buttons use plain `div[aria-label="ABBR±N.5"]` (NOT `div[role="button"]`).
- Data column buttons use `div[role="button"]`.
- Spread line element is a sibling of `span.MuiTypography-body3` in the leg `<a>` tag, matching `/^[+-]\d/`.
- Reordering only activates when `sideLines.some(Boolean)` — moneylines pass through unchanged.

---

## Spread `line` field was only capturing team name, not the spread value

**Bug:** Extension payload used `line: leg.side_label` which for spread bets gives just "Purdue" (team name). The actual spread number (`sideLine`, e.g. "+4.5") was scraped but never stored. The results cron couldn't compute spread coverage without the number.

**Fix:** Extension now uses `line: leg.side_line ? \`${leg.side_label} ${leg.side_line}\`.trim() : leg.side_label`. This gives "Purdue -4.5" for spreads and leaves totals/props/moneylines unchanged.

**Historical bets** with team-name-only `line` values will stay `pending` — can't be resolved retroactively without the spread number.

---

## Sport names from picktheodds include suffixes like "(M)" and "(W)"

**Discovery:** `sport` field captured from DOM can be "NCAAB (M)", "NCAAF (W)", etc. The results cron must normalize by stripping the parenthetical suffix before ESPN API lookup.

**Fix:** Applied in cron route: `bet.sport.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()` before looking up ESPN_SPORT_MAP.

---

## Results cron left many bet types pending due to several ESPN API mismatches

**Root causes (all fixed in `web/lib/espn.ts`):**

1. **NHL box score has no `names` field** — uses `labels` only. `group.names.indexOf()` threw TypeError and crashed the entire cron, leaving all subsequent bets (including normal Moneyline/Spread) unresolved.
   - Fix: `group.names ?? group.labels ?? group.keys ?? []` via new `groupColNames()` helper.

2. **Totals market stored as "Total Points" / "Total Points 1H"** — not "Total". `market === 'Total'` never matched.
   - Fix: `market === 'Total' || /^Total /.test(market)`. 1H totals use `competitor.linescores[0]+[1]`.

3. **Combo props use abbreviated stat names** — "Pts + Ast + Reb - Towns, K" → `statType = "Pts + Ast + Reb"`. No mapping existed, and no summing logic existed.
   - Fix: detect ` + ` in `statType`, split parts, sum individual stats from the same box score row.

4. **3-pointer market stored as "3PT - Monk, M"** — `statType = "3PT"` but only `"3-Pointers Made"` was in `STAT_NAME_MAP`.
   - Fix: added `'3PT': ['3PT']` to the map.

5. **Pitcher prop market names not in STAT_NAME_MAP** — picktheodds uses "Pitcher Allowed Hits", "Pitcher Earned Runs", "Pitcher Earned Outs", "Pitcher Walks", etc.
   - Fix: added all these entries. "Pitcher Earned Outs" uses `['IP']` with special IP→outs conversion (`"X.Y"` → `X*3+Y`).

6. **NHL player prop markets** ("Shots on Goal", "Blocked Shots") not in STAT_NAME_MAP.
   - Fix: added `'Shots on Goal': ['S']` and `'Blocked Shots': ['BS']`.

**Known limitation:** "Total Bases" cannot be computed from ESPN box score (no 2B/3B columns). Those bets stay pending.

---

## Extension leg scraper must not rely on a[href] — international books have no href

**Bug:** `scrapeRow` used `row.querySelectorAll('a[href]')` to find the two bet legs. BookMaker.eu (and potentially other international books) render as `<a>` without an `href` on PTO since there's no deep-link bet slip. This caused only 1 leg to be found, triggering the "< 2 legs" error on every BookMaker log attempt.

**Fix:** Find the two `div[aria-label]` book-name elements (excluding spread-value ones via `/[+-]\d/` filter) and walk 2 levels up to get the leg container. Works for both `<a href>` containers (US books) and plain `<div>` containers (BookMaker.eu). `Array.from(row.querySelectorAll('div[aria-label]')).filter(...).slice(0, 2).map(div => div.parentElement?.parentElement)`.

---

## Closing odds must match the exact spread/total line, not just team/direction

**Bug:** `findOutcome` for Spread bets matched by team name only — `outcome.point` (the spread value) was parsed from `betLine` but never checked. For Totals, only the Over/Under direction was checked, not the total number. This meant a bet on "Warriors -3" could return closing odds for "Warriors -5".

**Fix:** Both cases now also require `Math.abs(outcome.point - betLine_value) < 0.1`. If the closing line has moved off the bet's exact number, no closing odds are returned (bet stays without CLV) rather than returning wrong odds.

---

## De-vig uses TKO (Theoretical Kelly Optimization) method, not additive

**Decision:** Replaced the additive de-vig formula (`fairP = p / (p + q)`) with the TKO method from Pinnacle's article by Dan Abrams.

**TKO formula** for a two-way market (p1 = favourite implied prob, p2 = longshot implied prob):
```
b0 = log[p2 / (1 - p1)] / log[p1 / (1 - p2)]
true_fav_prob = b0 / (1 + b0)
```

**Why:** TKO accounts for the favourite-longshot bias — bookmakers apply more margin to longshots than favourites. Additive de-vig assumes margin is split equally, which is empirically wrong. TKO matches the probit-scale and odds-ratio methods that best fit real-world data.

**Note:** The article text has a typo in the intermediate derivation step (numerator/denominator swapped). The final formula `b0 = log[p2/(1-p1)] / log[p1/(1-p2)]` is correct and consistent with the mathematical steps.

---

## odds-api.io live API structure (verified 2026-04-02)

**Confirmed via live Playwright browser tests against the real API.**

**Events endpoint:** `GET /v3/events?sport=basketball&from=ISO&to=ISO&status=pending,live&limit=100`
- `from`/`to` params are supported and filter by event start time (ISO timestamps work)
- `status=pending,live` (comma-separated) is supported
- NBA league slug: `usa-nba` (can add `&league=usa-nba` for precision)
- Without league filter, ~24 basketball events appear in the ±2h window around NBA game time — NBA always within first 100

**Odds endpoint:** `GET /v3/odds?eventId=N&bookmakers=Circa,BetOnline.ag,FanDuel`
- Response: `bookmakers.{BookName}` is an array of `{name, updatedAt, odds[]}` markets
- Allowed bookmakers on this account: Caesars, Circa, DraftKings, FanDuel, BetOnline.ag

**Player Props structure (verified against FanDuel):**
- Single market named exactly `"Player Props"` (NOT separate per-stat markets like the docs show)
- Label format: `"FirstName LastName (StatType)"` — full name, stat in parens
- Confirmed NBA stat types: `Points`, `Rebounds`, `Assists`, `Blocks`, `Steals`, `3 Point FG`, `Pts+Asts`, `Pts+Rebs`, `Pts+Rebs+Asts`, `Rebs+Asts`, `Double+Double`, `Triple+Double`, `First Basket`
- `hdp` = the line number; `over`/`under` = decimal odds as strings (can be `"N/A"`)
- Multiple entries for same player = alternate lines; use `hdp` to find the exact bet line
- Circa and BetOnline.ag have NO Player Props for NBA — only ML/Spread/Totals

**Featured market names (Circa confirmed):** `"ML"`, `"Spread"`, `"Totals"`
- Totals `hdp` field = the total number (NOT `max`)

**All PROP_STAT_LABEL_MAP NBA entries verified correct.** `Turnovers` not available on FanDuel for NBA (dead entry, not a bug). `Double+Double`/`Triple+Double`/`First Basket` are outright markets (no hdp), correctly skipped.

**Full CLV simulation test passed:** fetchEvents → findEvent (team name match) → fetchEventOddsById → findClosingOdds all work correctly end-to-end.

**CRITICAL: fetchEvents must include `status=pending,live`** — the API defaults to pending-only. NBA games that went live before the cron fired were invisible to `findEvent`, producing "No event match" for every NBA bet. Fix: always pass `status=pending,live` to the events endpoint.

**Root cause of "CLV not working at all":** All bets in DB have closing_odds=null despite correct code. Issue is environmental — check: (1) `ODDS_API_KEY` set in Vercel env vars, (2) `CRON_SECRET` matches between GitHub Actions secret and Vercel, (3) GitHub Actions workflow enabled and not failing on every run.

---

## NBA prop names with diacritics cause extractPropOdds to miss

**Bug:** `normalize()` used `replace(/[^a-z0-9 ]/g, '')` which strips diacritic chars entirely — "Jokić" became "joki" while the bet's parsed lastName "Jokic" normalized to "jokic". `"jokic".includes("joki")` is true but the comparison goes the other way (`labelNorm.includes(lastNameNorm)`), so `"nikola joki points".includes("jokic")` = false. All props for Jokić, Dončić, etc. failed silently.

**Fix:** Apply `s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` before lowercasing. NFD decomposes "ć" → "c" + combining accent, then the accent strip removes the combining char, leaving "c". Now "Jokić" normalizes to "jokic" correctly.

---

## Compact leg odds corrupted by expanded book-odds table spans (moneyline swap root cause)

**Bug:** `scrapeRow` found compact leg odds with `row.querySelectorAll('span.MuiTypography-oddsRobotoMono')`. When the row is expanded, the book-odds table (inside a `<table>`) uses the same class for every odds cell. Those extra spans were picked up first (or mixed in), making `oddsValues[0,1]` be random table odds (e.g. Circa's -196) instead of the compact leg odds (+175/-176). This corrupted the `compactOdds` ground truth used by `fixBookOddsSideOrder`, which then bailed out without fixing the swap.

**Fix:** Add `.filter(el => !el.closest('table'))` to the span query in `scrapeRow`. Compact leg spans are never inside a `<table>`; expanded table spans always are.

**Pattern:** Any time a selector is used on the whole row container while expanded, table descendants must be explicitly excluded.

---

## Index-based fallback in book_odds lookup causes one-sided books to appear on both legs

**Bug:** In `handleLogClick` and `postBets`, odds for a given book+leg were looked up as `sides[sideLabel] ?? sides[Object.keys(sides)[i]]`. If a book (e.g. ProphetX) only offered odds on one side (e.g. Under), the fallback assigned those Under odds to the Over leg (index 0) because `Object.keys(sides)[0]` was "Under".

**Fix:** Remove the index-based fallback entirely. Use `sides[sideLabel] ?? null`. If a book has no odds for a side label, it simply won't appear for that leg.

---

## Historical bets with no CLV must be batch-marked clv_checked=true manually

**Context:** The closing-odds cron only processes bets with game_time within `[now-60min, now+25min]`. Any bet whose game_time has passed more than 60 minutes ago will NEVER be queried again — it's permanently outside the cron window.

**Discovery:** 1,014 bets across all sports (NBA: 594, MLB: 170, NHL: 146, Tennis: 50, NCAAB: 36) were stuck `clv_checked=false, closing_odds=null` because their games had ended weeks/days before the cron system was fully functional. The dashboard showed "-" for CLV instead of "n/a" for all of them.

**Root cause:** Before cron-job.org was configured and `status=pending,live` was added to fetchEvents, the cron couldn't capture CLV for live/settled games. Those historical bets are stuck forever outside the cron window.

**Fix:** One-time batch update: `UPDATE bets SET clv_checked=true WHERE clv_checked=false AND closing_odds IS NULL AND game_time < (now - 2h)`. This marks them as definitive misses so the dashboard shows "n/a".

**Ongoing:** The cron itself is working correctly. Tonight's bets (game_time in the future) will get CLV captured automatically at game time. If the cron is ever down for an extended period, run the batch update again to clean up stuck bets.

---

## Vercel Hobby plan log retention is ~1-2 hours only

**Discovery:** `vercel logs --since 19h` only returned logs from the last ~30 minutes despite the large `--since` parameter. The `--limit` parameter caps total entries, and with every-minute cron fires, 500-2000 entries ≈ 30-60 minutes of history.

**Impact:** Cannot debug last night's cron failures via Vercel logs. Must use local dev server or Supabase DB state to infer cron behavior.

**Workaround:** For debugging a specific cron run, temporarily set a bet's game_time to be in the current window, then observe the DB state change immediately after (the Vercel cron fires within 1 minute of the game_time entering the window).

---

## PTO sometimes shows moneyline arb books on the wrong sides (book-assignment swap)

**Bug:** For a moneyline arb between two books (e.g. NoVig and Bookmaker on Seattle vs LA), PTO's compact leg display sometimes shows them on the wrong sides. It might render "NoVig / Seattle" and "Bookmaker / LA", when the actual arb positions are "Bookmaker / Seattle" (better odds: +163) and "NoVig / LA" (better odds: -151). The existing `fixBookOddsSideOrder` didn't catch this — it only fixes **side-key ordering within a book's table column**, not which **book** is on which **side**. Since `book_odds["NoVig"]["Seattle"] = +151` matched the compact odds (+151), it concluded "already correct."

**Fix:** Added `fixLegBookAssignment(legs, book_odds)` which runs after `fixBookOddsSideOrder` and before enrichment. It checks if `leg1.book` offers better American odds for `leg0.side_label` than `leg0.book` does. If so, it swaps `book`, `bookImgAlt`, and `href` between the two legs (side_labels stay in place). Higher American odds = better for the bettor (+163 > +151, -151 > -181).

**Key distinction:** `fixBookOddsSideOrder` = fixes side label order within book_odds. `fixLegBookAssignment` = fixes which book is assigned to which leg.
