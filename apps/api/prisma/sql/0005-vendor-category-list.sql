-- Intake form offers only these vendor categories, in this order (user decision 2026-10-27).
-- The others are deactivated, not deleted: earlier cases still reference some of them and an admin
-- can re-enable one on the categories page. Sub-categories are unchanged (they follow their parent).
-- Idempotent; apply with: prisma db execute --file prisma/sql/0005-vendor-category-list.sql
UPDATE vendor_category AS c
SET active = (v.sort_order IS NOT NULL),
    -- inactive ones move below the active list (applied once: +1000 only while still under 1000)
    sort_order = COALESCE(v.sort_order, CASE WHEN c.sort_order < 1000 THEN c.sort_order + 1000 ELSE c.sort_order END),
    updated_at = now()
FROM vendor_category AS c2
LEFT JOIN (VALUES
  ('vendor_others_domestic', 10),
  ('vendor_collection', 20),
  ('vendor_dealer_twl', 30),
  ('vendor_dealer_ucl', 40),
  ('vendor_foreign_creditor', 50),
  ('vendor_dealer_ecv', 60),
  ('vendor_dealer_ncl', 70)
) AS v(key, sort_order) ON v.key = c2.key
WHERE c.id = c2.id;
