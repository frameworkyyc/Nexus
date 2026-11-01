-- Anchorage is mounted on a footing or on plinths, independently of how many footings and plinths there are.
-- Until now an anchorage group WAS a set of plinths (foundation_anchorage_groups: how many plinths use a type), so anchorage mounted straight on a footing had to be
-- entered as plinths, which counted them as plinths and created plinth work that does not exist. Additive: nothing is dropped or rewritten.
--  * foundation_anchorage_groups keeps meaning "a set of identical plinths" (plinth_count, default dimensions). Its anchorage_type_id stays as the set's first
--    anchorage type, for views that show one type per plinth.
--  * foundation_anchorages: an anchorage group = qty anchorages of one library type, mounted on the footing (mount_group_id NULL) or on every plinth of a set.
--    A mount can have several, of different types. Bolt, nut, washer, template and plate totals are the type's components x qty x the footings or plinths carrying it.
--  * foundation_bolts and foundation_embeds gain mount_group_id (NULL = the footing, as before; otherwise every plinth of that set).
CREATE TABLE foundation_anchorages (
  id                TEXT PRIMARY KEY,
  foundation_id     TEXT NOT NULL REFERENCES foundations (id),
  mount_group_id    TEXT REFERENCES foundation_anchorage_groups (id),
  anchorage_type_id TEXT NOT NULL REFERENCES anchorage_types (id),
  qty               INTEGER NOT NULL CHECK (qty >= 1),
  seq               INTEGER NOT NULL
);
CREATE INDEX foundation_anchorages_foundation ON foundation_anchorages (foundation_id);

ALTER TABLE foundation_bolts  ADD COLUMN mount_group_id TEXT REFERENCES foundation_anchorage_groups (id);
ALTER TABLE foundation_embeds ADD COLUMN mount_group_id TEXT REFERENCES foundation_anchorage_groups (id);

-- Existing plinth-mounted anchorage: every plinth of a set with an anchorage type carries one anchorage of that type. Counts are unchanged (plinths of the type
-- x quantity), plinths and their activities are untouched, and sets with no type simply have no anchorage. Footing bolts and embed plates stay on the footing.
INSERT INTO foundation_anchorages (id, foundation_id, mount_group_id, anchorage_type_id, qty, seq)
SELECT 'fa-' || id, foundation_id, id, anchorage_type_id, 1, seq FROM foundation_anchorage_groups WHERE anchorage_type_id IS NOT NULL;

UPDATE schema_info SET value = '28' WHERE key = 'schema_version';
