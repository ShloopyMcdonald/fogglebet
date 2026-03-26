create extension if not exists "pgcrypto";

create type bet_result as enum ('pending', 'win', 'loss', 'push');

create table bets (
  id           uuid primary key default gen_random_uuid(),
  arb_id       uuid not null,
  is_taken     boolean not null,
  recorded_at  timestamptz not null default now(),
  game_time    timestamptz,
  bet_name     text not null,
  sport        text,
  market       text,
  line         text,
  book         text not null,
  odds         integer not null,
  liquidity    numeric,
  ev_percent   numeric,
  arb_percent  numeric,
  closing_odds integer,
  clv          numeric,
  result       bet_result not null default 'pending',
  profit_loss  numeric,
  stake        numeric not null default 1,
  source_url   text,
  notes        text
);

-- Index for cron jobs to find pending bets quickly
create index bets_result_game_time_idx on bets (result, game_time);

-- Index to fetch both sides of an arb together
create index bets_arb_id_idx on bets (arb_id);
