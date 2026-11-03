-- 0046: the owner supplied the real dates of the legacy tournaments TN4-TN12.
-- Without them every legacy placement carried no time, so the roster treated
-- all 61 historical Players as inactive. ADR-0177 decisions 16, 17 and 19 need
-- a real event time per historical tournament to derive the activity window.
CREATE TABLE legacy_tournament_events (
    tournament_number INT UNSIGNED NOT NULL,
    event_date VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    held_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (tournament_number),
    CONSTRAINT ck_legacy_tournament_event_date CHECK (
        event_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO legacy_tournament_events (tournament_number, event_date, held_at_ms) VALUES
    (4, '2023-05-19', 1684454400000),
    (5, '2023-09-29', 1695945600000),
    (6, '2024-01-26', 1706227200000),
    (7, '2024-05-31', 1717113600000),
    (8, '2024-09-06', 1725580800000),
    (9, '2025-01-03', 1735862400000),
    (10, '2025-05-16', 1747353600000),
    (11, '2025-10-03', 1759449600000),
    (12, '2026-03-27', 1774569600000);
