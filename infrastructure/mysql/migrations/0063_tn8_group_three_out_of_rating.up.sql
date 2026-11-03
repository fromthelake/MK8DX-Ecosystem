-- TN8's third qualification group leaves the rating.
--
-- Its evening was recorded on a capture card that failed: the video source
-- inventory (docs/provenance/TOURNAMENT_VIDEO_SOURCE_INVENTORY_2026-09-05.md)
-- marks it "verloren - Defect Capture Card". Three of its twelve races reached
-- the corrected history and none of them carries a track. The other two
-- qualification groups that night have twelve each.
--
-- Three races out of twelve is not a qualification group, it is a fragment of
-- one: the twelve Players in it were rated on a quarter of the evening
-- everybody else was rated on. The owner decided on 2026-09-10 that the group
-- does not count - first in the community's own statistics (deploy 244), and
-- now in the rating itself, so the two say the same thing.
--
-- This marks the races; it does not rewrite a single rating. The ratings are
-- recomputed afterwards by
-- `api/dist/rating/history-recompute-main.js`, which opens a NEW rating epoch
-- and leaves every earlier epoch complete and auditable (ADR-0155). Nothing
-- here is destructive: the placements, the finishing order and the points stay
-- exactly as they were, and the down file puts the flag back.

-- The schema itself insists on the reason: `ck_history_race_exclusion` says a
-- race that does not score has to say why. That is the right rule and this
-- migration answers it rather than working around it - the first attempt set
-- the flag alone and the constraint refused the whole statement, which is
-- exactly what a constraint is for.

UPDATE tournament_history_races AS race
INNER JOIN tournament_history_sections AS section
        ON section.tournament_history_section_id
         = race.tournament_history_section_id
SET race.counts_toward_rating = 0,
    race.exclusion_reason = 'TN8 qualification group 3: capture card defect, evening lost'
WHERE section.tournament_number = 8
  AND section.stage = 'qualifier'
  AND section.sequence_number = 3;
