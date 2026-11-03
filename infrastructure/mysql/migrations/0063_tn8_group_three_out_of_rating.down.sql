-- Put TN8's third qualification group back into the rating.
--
-- The three races it holds counted before 2026-09-10 and would count again;
-- the ratings themselves are whatever the last recompute wrote, so undoing
-- this migration is only half of a reversal - the other half is running
-- `history-recompute-main.js` again, which opens another epoch.

UPDATE tournament_history_races AS race
INNER JOIN tournament_history_sections AS section
        ON section.tournament_history_section_id
         = race.tournament_history_section_id
SET race.counts_toward_rating = 1,
    race.exclusion_reason = NULL
WHERE section.tournament_number = 8
  AND section.stage = 'qualifier'
  AND section.sequence_number = 3;
