/**
 * Every placement of a night this product ran itself, on the terms the
 * Tournament ranking counts it: the night is finalized and not removed, and the
 * race is the latest revision of one that counts toward the standings.
 *
 * The community's history before the console - TN4 to TN12 - lives in the
 * imported tables, and several public readers were written when that was all
 * there was. TN13 was the first night the console ran end to end, and those
 * readers simply never saw it: the Tracks card, the opponents list and the
 * head-to-head all still ended at TN12 (owner, 2026-09-17). This fragment is
 * the one place they read the console's nights from, so a TN14 arrives in all
 * of them the moment it is finalized.
 *
 * Columns: `player_id`, `finish_position`, `race_points` (signed),
 * `track_id` (nullable), `edition_number` (nullable), `held_at_ms`,
 * `race_key` (namespaced so it can never equal a history race id), and
 * `field_size` (how many finished that race).
 */
export const CONSOLE_NIGHT_PLACEMENTS = `
  SELECT consolePlacement.player_id AS player_id,
         consolePlacement.finish_position AS finish_position,
         CAST(consolePlacement.race_points AS SIGNED) AS race_points,
         consoleRevision.track_id AS track_id,
         consoleNight.edition_number AS edition_number,
         COALESCE(consoleNight.start_at_ms, consoleNight.finalized_at_ms,
                  consoleNight.created_at_ms) AS held_at_ms,
         CONCAT('console:', consoleRevision.tournament_race_result_id) AS race_key,
         (SELECT COUNT(*)
            FROM tournament_race_placements AS consoleField
           WHERE consoleField.tournament_race_result_revision_id =
                 consoleRevision.tournament_race_result_revision_id) AS field_size
    FROM tournament_race_placements AS consolePlacement
    INNER JOIN tournament_race_result_revisions AS consoleRevision
      ON consoleRevision.tournament_race_result_revision_id =
         consolePlacement.tournament_race_result_revision_id
     AND consoleRevision.counts_toward_standings = 1
     AND consoleRevision.revision_number = (
       SELECT MAX(consoleLatest.revision_number)
         FROM tournament_race_result_revisions AS consoleLatest
        WHERE consoleLatest.tournament_race_result_id =
              consoleRevision.tournament_race_result_id
     )
    INNER JOIN tournament_group_races AS consoleLink
      ON consoleLink.tournament_race_result_id = consoleRevision.tournament_race_result_id
    INNER JOIN tournament_groups AS consoleGroup
      ON consoleGroup.tournament_group_id = consoleLink.tournament_group_id
    INNER JOIN tournaments AS consoleNight
      ON consoleNight.tournament_id = consoleGroup.tournament_id
     AND consoleNight.stage = 'finalized'
     AND consoleNight.lifecycle_status = 'active'`;
