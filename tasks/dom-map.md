# picktheodds DOM Scraping Map

## Row Selector
Content-based detection (works in both narrow and wide layouts):
- Find all `span.MuiTypography-navHeader` elements
- Walk up the DOM tree to find the nearest ancestor containing `div[aria-label]` × 2+
- That ancestor is the arb row

`[rowtype="ARBITRAGE"]` only exists in the narrow layout — do not rely on it.

---

## Stable Selectors (safe to use)

| Field | Selector | Method |
|-------|----------|--------|
| Sport | `.MuiTypography-sofiaSansHeaderUppercase` | `.textContent` |
| Teams | `.MuiTypography-body3` (first two within row) | `.textContent` |
| Market/Prop | `p[aria-label]` | `getAttribute('aria-label')` — most reliable |
| Game time | `p.MuiTypography-body2` (in time section) | `.textContent` — two formats, see below |
| Arb profit $ | `span.MuiTypography-navHeader` (contains `$`) | `.textContent`, strip `$` |
| Arb percent % | `span.MuiTypography-navHeader` (contains `%`) | `.textContent`, strip `%` |
| Book name | `div[aria-label]` (img container within `<a>`) | `getAttribute('aria-label')` |
| Side + line | `span.MuiTypography-body3` (within leg `<a>`) | `.textContent` — e.g. "Over 6.5" |
| Leg odds | `input[type="text"]` (two per row) | `.value` — e.g. "+171" |
| Wager amounts | `input[type="number"][name="0"]`, `[name="1"]` | `.value` |
| Expanded odds | `span.MuiTypography-oddsRobotoMono` | `.textContent` |

---

## Game Time — Two Formats

**Format A** (time only, no date — some same-day games):
```html
<p class="MuiTypography-body2 ..."><strong>09:40 PM</strong></p>
```
→ Extract from `<strong>` child. No date — must combine with today's date.

**Format B** (full date + time — future/multi-day games):
```html
<p class="MuiTypography-body2 ...">March 26, 2026 at 04:15 PM</p>
```
→ Extract directly from `<p>` text. Full date included — preferred.

**Strategy:** Check if `<strong>` child exists. If yes → Format A. If no → Format B (use full `<p>` text).

**URL timestamp fallback** (Bovada-style URLs only):
- `houston-rockets-minnesota-timberwolves-202603252130` → 2026-03-25 21:30
- ⚠️ Not all books include timestamps — NoVig URL is `/events/uuid/pto` with no timestamp
- Use as secondary confirmation only, not primary source

---

## Leg Structure
Each arb has two `<a>` tags linking to the sportsbook:
```
<a href="https://[sportsbook-url]/...">
  <div aria-label="Bovada">      ← book name (aria-label)
  <span.MuiTypography-label>Over 6.5</span>   ← side + line
</a>
<input[type="text"] value="+171">             ← leg odds (outside <a>)
<input[type="number"][name="0"] value="76.16"> ← wager
```
- Leg 1 → `input[name="0"]`
- Leg 2 → `input[name="1"]`

---

## Additional Fields (MLB)
MLB rows show pitcher names below team names:
```html
<span class="MuiTypography-caption ...">Rasmussen, D</span>
```
Selector: `.MuiTypography-caption` — optional field, capture when present.

---

## DO NOT USE
- Hashed `css-*` classes (`css-w7jynk`, `css-1y9zff4`, `css-773eml`, etc.) — change on every build

---

## TBD: Liquidity Selector
Liquidity is shown for exchange legs (Novig, ProphetX, Polymarket) in the collapsed row view.
Visible in UI (e.g. `$103`, `$4.9k`) but not found in HTML dumps yet — likely truncated.
**To find:** Run `copy()` on a row with a Novig/ProphetX leg and search the output for the dollar amount visible on screen.
Expected location: inside the leg section, near/below the odds input.
