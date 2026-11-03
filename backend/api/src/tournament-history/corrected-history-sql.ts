// The corrected tournament history, as the shape a reading surface wants.
//
// Migration 0057 built this beside the frozen legacy tables rather than on top
// of them, because those tables are the evidence ADR-0154 proved. The ratings
// were rebuilt from it (ADR-0189) - 870 races against the legacy 865, the
// difference being five races recovered from video that were never entered at
// the time. The product kept counting from the legacy tables, so 28 Players
// saw a race total one or two lower than the history their own rating was
// computed from.
//
// One fragment, used by every surface that counts races, so the two cannot
// drift apart again.

/**
 * Points stay on the twelve-place table for every race, which is what the
 * legacy reading already did.
 *
 * `tournament_history_placements.race_points` holds what the recording
 * actually showed, and for a short field that is not the same number. Mixing
 * the two would put two scales in one column; keeping one definition means
 * this change moves only *which* races are counted, which is the thing to
 * verify. Whether the observed points should replace the table is a separate
 * question, and the column is there when it is asked.
 */
const RACE_POINTS = `CAST(ELT(placement.finish_position,
                             15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1) AS SIGNED)`;

/**
 * Every placement in the corrected history, including the three races that do
 * not count toward rating: a short field is a rating decision, not a claim
 * that the race was never driven. `tournament_history_races.exclusion_reason`
 * keeps that distinction legible.
 *
 * The date comes from `legacy_tournament_events`, which is where a
 * Tournament's own date lives; the history tables carry none of their own.
 */
export const CORRECTED_HISTORY_PLACEMENTS = `
  SELECT placement.player_id AS player_id,
         placement.finish_position AS finish_position,
         ${RACE_POINTS} AS race_points,
         CONCAT('history:', section.tournament_number) AS tournament_key,
         CONCAT('history:', race.tournament_history_race_id) AS race_key,
         event.held_at_ms AS occurred_at_ms
    FROM tournament_history_placements AS placement
    INNER JOIN tournament_history_races AS race
      ON race.tournament_history_race_id =
         placement.tournament_history_race_id
    INNER JOIN tournament_history_sections AS section
      ON section.tournament_history_section_id =
         race.tournament_history_section_id
    LEFT JOIN legacy_tournament_events AS event
      ON event.tournament_number = section.tournament_number`;

/**
 * The same history grouped the way a Tournament career reads it: one row per
 * Player per section, with the section named as the product names it
 * ("Kampioen", "Kwalificatie Groep 2") rather than as the legacy label
 * ("TN11: Poule B") the wording drifted through over the years.
 */
export const CORRECTED_HISTORY_SECTION_STANDINGS = `
  SELECT section.tournament_number AS tournamentNumber,
         section.display_name AS sectionLabel,
         player.public_id AS playerId,
         player.display_name AS displayName,
         SUM(${RACE_POINTS}) AS points,
         COUNT(*) AS races
    FROM tournament_history_placements AS placement
    INNER JOIN tournament_history_races AS race
      ON race.tournament_history_race_id =
         placement.tournament_history_race_id
    INNER JOIN tournament_history_sections AS section
      ON section.tournament_history_section_id =
         race.tournament_history_section_id
    INNER JOIN players AS player
      ON player.player_id = placement.player_id
     AND player.record_status = 'active'
     AND player.visibility = 'public'
   GROUP BY section.tournament_number, section.sequence_number,
            section.display_name,
            player.player_id, player.public_id, player.display_name
   ORDER BY section.tournament_number ASC, section.sequence_number ASC,
            points DESC, player.public_id ASC`;

/**
 * Character use beside the derived section standing. One row per recorded
 * character/variant pair, most-used first, lets the public reader choose the
 * character that represents a Player's tournament section without confusing
 * it with their current profile avatar. Older nights without recorded video
 * simply yield no row.
 */
export const CORRECTED_HISTORY_SECTION_CHARACTER_USE = `
  SELECT section.tournament_number AS tournamentNumber,
         section.display_name AS sectionLabel,
         player.public_id AS playerId,
         placement.character_id AS characterId,
         placement.character_variant_id AS characterVariantId,
         COUNT(*) AS uses
    FROM tournament_history_placements AS placement
    INNER JOIN tournament_history_races AS race
      ON race.tournament_history_race_id =
         placement.tournament_history_race_id
    INNER JOIN tournament_history_sections AS section
      ON section.tournament_history_section_id =
         race.tournament_history_section_id
    INNER JOIN players AS player
      ON player.player_id = placement.player_id
     AND player.record_status = 'active'
     AND player.visibility = 'public'
   WHERE placement.character_id IS NOT NULL
   GROUP BY section.tournament_number, section.sequence_number,
            section.display_name, player.player_id, player.public_id,
            placement.character_id, placement.character_variant_id
   ORDER BY section.tournament_number ASC, section.sequence_number ASC,
            player.public_id ASC, uses DESC, placement.character_id ASC,
            placement.character_variant_id ASC`;

/**
 * One point per placement in the corrected history, in the order it was
 * raced, with the rating the current epoch computed for it.
 *
 * Every placement is a point, including the three races that do not count
 * toward rating: they were driven, so they belong in a race total. Those have
 * no rating event, so their mu and sigma arrive null and the reader carries
 * the previous value forward - the rating did not move, which is exactly what
 * "excluded from rating" means.
 *
 * The trajectory is the current epoch's, not the imported mariokart8.nl curve
 * the legacy tables hold. After ADR-0189 rebuilt every rating, showing the old
 * curve beside a new standing put two answers on one screen.
 */
export const CORRECTED_HISTORY_TRAJECTORY = `
  SELECT race.race_sequence AS sequence,
         section.tournament_number AS tournamentNumber,
         section.display_name AS sectionLabel,
         race.race_index AS raceIndex,
         placement.finish_position AS finishPosition,
         event.mu_after AS mu,
         event.sigma_after AS sigma
    FROM tournament_history_placements AS placement
    INNER JOIN tournament_history_races AS race
      ON race.tournament_history_race_id =
         placement.tournament_history_race_id
    INNER JOIN tournament_history_sections AS section
      ON section.tournament_history_section_id =
         race.tournament_history_section_id
    INNER JOIN players AS player
      ON player.player_id = placement.player_id
     AND player.record_status = 'active'
     AND player.visibility = 'public'
    LEFT JOIN player_rating_events AS event
      ON event.player_id = placement.player_id
     AND event.source_reference = CONCAT('history_race:', race.race_sequence)
     AND event.rating_epoch = (SELECT MAX(rating_epoch)
                                 FROM player_rating_events)
   WHERE player.public_id = ?
   ORDER BY race.race_sequence ASC
   LIMIT 2000`;
