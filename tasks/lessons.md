# FoggleBet — Lessons Learned

_Permanent log of bugs, corrections, and decisions. Updated after every user correction._

---

## book_odds scraping — expanded odds table DOM structure

**Problem:** `book_odds` was always saved as `{}`.

**Root causes (three layered bugs):**

1. **Book headers filtered out by `!el.closest('a')`** — The expanded odds table's book column headers have `div[aria-label]` inside `<a>` tags (same as the collapsed leg icons). The filter excluded them all. Fix: find the header table structurally (the `<table>` whose first row has `>1 div[aria-label]`), then build `colMap` from its cells — no `<a>` filtering needed.

2. **`div[aria-label]` is empty in header cells** — The `aria-label` attribute on the `div` is `""` in the expanded table header. The book name is on the `img[alt]` attribute inside the cell. Fix: try `img[alt]` as a fallback when `div[aria-label]` is empty.

3. **Both sides are in one `<tr>`, both legs had the same fallback key** — The expanded table has exactly 2 `<tr>` rows: one header row (book logos, 0 odds spans) and one data row (all sides, N odds spans per book cell). Side labels come from `cells[0]`'s direct children (e.g. "Over 11.5", "Under 11.5"). When `side_label` was null, both legs fell back to the same `bet_name` string, causing the Over entry to be overwritten by the Under. Fix: derive side labels from `cells[0].children` in the data row; fall back to `side_0`/`side_1` (not `bet_name`) when unavailable.

**Key DOM facts for picktheodds expanded arb rows:**
- 2 total `<tr>` in expanded section: header (in headerTable) + 1 data row (outside headerTable)
- Data row `cells[0]`: both side labels as direct children (e.g. two `<span>` or `<div>`)
- Data row `cells[N]`: per side — `span[class=""]` (raw odds), `span.MuiTypography-oddsRobotoMono` (formatted odds), `span[class=""]` containing `$` (liquidity)
- Book name is in `img[alt]` inside header cells, NOT in `div[aria-label]`
- Liquidity spans have **empty class attribute** (`class=""`), NOT `MuiTypography-label` — always verify selectors with console before assuming

**Rule: always ask for console output before writing a DOM selector for a new field.**

## Leg odds and liquidity must come from book_odds, not main-row spans

The expanded table's DOM comes before the leg buttons in DOM order, so `querySelectorAll('span.MuiTypography-oddsRobotoMono')` on the whole row picks up BEST/average column odds first — not the leg odds.

**Fix:** Call `scrapeBookOdds` before showing the side picker modal. Get leg `odds` and `liquidity` from `book_odds[leg.book][side_i]` — the same expanded table source that already works correctly for `book_odds`.
