-- Sequential approval levels L1 -> L2 -> L3 (between the parallel reviews and SAP confirmation).
-- Each vendor category chooses the levels it uses (none by default, so existing flows are
-- unchanged); a case keeps the levels it was submitted with. One reporting table per level, the
-- same shape as the other per-stage tables.
-- Additive and idempotent; apply with: prisma db execute --file prisma/sql/0004-approval-levels.sql

ALTER TABLE vendor_category ADD COLUMN IF NOT EXISTS approval_levels text[] NOT NULL DEFAULT '{}';
ALTER TABLE "case"          ADD COLUMN IF NOT EXISTS approval_levels text[] NOT NULL DEFAULT '{}';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['case_l1', 'case_l2', 'case_l3'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id             char(26)    PRIMARY KEY,
        case_id        char(26)    NOT NULL UNIQUE REFERENCES "case"(id) ON DELETE CASCADE ON UPDATE CASCADE,
        status         text        NOT NULL DEFAULT 'pending',
        decision       text,
        remark         text,
        actioned_by_id char(26),
        entered_at     timestamptz(6),
        completed_at   timestamptz(6),
        data           jsonb       NOT NULL DEFAULT '{}',
        created_at     timestamptz(6) NOT NULL DEFAULT now(),
        updated_at     timestamptz(6) NOT NULL DEFAULT now()
      )$f$, t);
  END LOOP;
END $$;
