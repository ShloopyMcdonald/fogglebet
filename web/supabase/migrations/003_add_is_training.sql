alter table bets add column is_training boolean not null default false;

create index bets_is_training_idx on bets (is_training);
