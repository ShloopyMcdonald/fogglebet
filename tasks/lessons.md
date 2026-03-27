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
