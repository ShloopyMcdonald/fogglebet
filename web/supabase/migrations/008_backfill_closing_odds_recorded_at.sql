-- Backfill closing_odds_recorded_at for bets that had closing odds captured
-- before the column was added. Use game_time as a reasonable proxy since
-- closing odds are captured at/around game start time.
UPDATE bets
SET closing_odds_recorded_at = game_time
WHERE closing_odds IS NOT NULL
  AND closing_odds_recorded_at IS NULL
  AND game_time IS NOT NULL;
