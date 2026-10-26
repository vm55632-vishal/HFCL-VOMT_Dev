-- A case raised by one person on behalf of another proposer. Additive and idempotent.
-- Apply with:
--   corepack pnpm --filter @vop/api exec prisma db execute --file prisma/sql/0002-case-on-behalf-of.sql --schema prisma/schema.prisma
BEGIN;
ALTER TABLE "case" ADD COLUMN IF NOT EXISTS on_behalf_of_id char(26) REFERENCES users(id);
CREATE INDEX IF NOT EXISTS case_on_behalf_of_id_idx ON "case" (on_behalf_of_id);
COMMIT;
