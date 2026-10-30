-- Procurement: purchase orders and deliveries recorded against consolidated material requirements (an area's total of one specification), not
-- against each foundation. Additive only: the existing materials, orders (ordered_qty), receipts and history are not touched and still count
-- toward the same totals. group_key identifies the consolidated requirement; area, category and specification are copied onto every
-- order and delivery line so the record stays readable if the requirement later changes or goes away.

CREATE TABLE purchase_orders (
  id           TEXT PRIMARY KEY,
  po_number    TEXT NOT NULL,
  supplier_id  TEXT,
  supplier     TEXT NOT NULL DEFAULT '',
  order_date   TEXT NOT NULL,
  expected_date TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  cancelled    INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL DEFAULT '',
  seq          INTEGER NOT NULL
);
CREATE INDEX purchase_orders_number ON purchase_orders (po_number);

CREATE TABLE purchase_order_lines (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES purchase_orders (id),
  group_key     TEXT NOT NULL,
  area_id       TEXT,
  area          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  name          TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  size          TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL DEFAULT 'ea',
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  seq           INTEGER NOT NULL
);
CREATE INDEX purchase_order_lines_order ON purchase_order_lines (order_id);
CREATE INDEX purchase_order_lines_group ON purchase_order_lines (group_key);

-- One delivery (a shipment, with who confirmed it and when) can cover several requirements, areas and purchase orders' lines.
CREATE TABLE procurement_deliveries (
  id          TEXT PRIMARY KEY,
  order_id    TEXT REFERENCES purchase_orders (id),
  delivery_date TEXT NOT NULL,
  reference   TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  seq         INTEGER NOT NULL
);

CREATE TABLE procurement_delivery_lines (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES procurement_deliveries (id),
  order_line_id TEXT,
  group_key     TEXT NOT NULL,
  area_id       TEXT,
  area          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  name          TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  size          TEXT NOT NULL DEFAULT '',
  unit          TEXT NOT NULL DEFAULT 'ea',
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  seq           INTEGER NOT NULL
);
CREATE INDEX procurement_delivery_lines_delivery ON procurement_delivery_lines (delivery_id);
CREATE INDEX procurement_delivery_lines_group ON procurement_delivery_lines (group_key);

-- Material that has arrived, set aside for a particular foundation. Received and allocated are different things: receiving a bulk delivery
-- never creates these; allocating never changes what was received.
CREATE TABLE material_allocations (
  id            TEXT PRIMARY KEY,
  group_key     TEXT NOT NULL,
  foundation_id TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  allocated_by  TEXT NOT NULL DEFAULT '',
  allocated_at  TEXT NOT NULL DEFAULT '',
  seq           INTEGER NOT NULL
);
CREATE INDEX material_allocations_group ON material_allocations (group_key);

UPDATE schema_info SET value = '15' WHERE key = 'schema_version';
