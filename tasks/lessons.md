# FoggleBet — Lessons Learned

_Permanent log of bugs, corrections, and decisions. Updated after every user correction._

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
