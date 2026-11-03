ALTER TABLE tournament_groups
  DROP COLUMN tie_break_orders_json;

ALTER TABLE tournaments
  DROP COLUMN final_tie_break_mode,
  DROP COLUMN qualifier_tie_break_mode;
