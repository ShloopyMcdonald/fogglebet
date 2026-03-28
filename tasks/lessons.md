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
