-- The character a Player drove in a group is recorded evidence: Tournament
-- Live and the recorded-video Processor both write it into their score
-- workbook ("Character" and "Character Roster"), and the community's own
-- report prints that picture beside every name. Until now the import read
-- those columns and dropped them.
--
-- One row per group member already exists, so the character belongs there:
-- the canonical key when the catalog knows it, and always the name the
-- workbook wrote, so an unknown or misspelled character is preserved rather
-- than lost.
ALTER TABLE tournament_group_members
    ADD COLUMN character_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN character_label VARCHAR(64) NULL,
    ADD COLUMN character_roster VARCHAR(64) NULL;
