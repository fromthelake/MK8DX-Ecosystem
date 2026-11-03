ALTER TABLE tournaments
  ADD COLUMN qualifier_tie_break_mode ENUM('sp', 'lottery', 'manual') NOT NULL DEFAULT 'sp'
    AFTER owner_seating_mode,
  ADD COLUMN final_tie_break_mode ENUM('sp', 'lottery', 'manual') NOT NULL DEFAULT 'sp'
    AFTER qualifier_tie_break_mode;

ALTER TABLE tournament_groups
  ADD COLUMN tie_break_orders_json JSON NULL AFTER manual_score_segments;
