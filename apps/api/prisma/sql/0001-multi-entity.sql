-- ADR-0008: multi-entity. Additive and idempotent: safe to run more than once.
-- Apply with:
--   corepack pnpm --filter @vop/api exec prisma db execute --file prisma/sql/0001-multi-entity.sql --schema prisma/schema.prisma
--
-- Existing data (cases, people, team structure) is assigned to Hero FinCorp (HFCL).

BEGIN;

-- Opaque 26-character ids for rows created here (same shape as the app's ULIDs).
CREATE OR REPLACE FUNCTION pg_temp.vop_id() RETURNS char(26) LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  FROM generate_series(1, 26)
$$;

-- 1. Entities -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity (
  id            char(26) PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  email_domains text[] NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz(6) NOT NULL DEFAULT now(),
  updated_at    timestamptz(6) NOT NULL DEFAULT now()
);

-- Email domains are configuration: set the real ones from the admin side. vop.local is the
-- development/demo domain.
INSERT INTO entity (id, code, name, email_domains, sort_order)
VALUES (pg_temp.vop_id(), 'HFCL', 'Hero FinCorp Limited', ARRAY['vop.local'], 1)
ON CONFLICT (code) DO NOTHING;
INSERT INTO entity (id, code, name, email_domains, sort_order)
VALUES (pg_temp.vop_id(), 'HHFL', 'Hero Housing Finance Limited', ARRAY[]::text[], 2)
ON CONFLICT (code) DO NOTHING;

-- 2. Per-entity roles -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_entity_role (
  id         char(26) PRIMARY KEY,
  user_id    char(26) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id  char(26) NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  role_key   text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  UNIQUE (user_id, entity_id, role_key)
);
CREATE INDEX IF NOT EXISTS user_entity_role_entity_id_idx ON user_entity_role (entity_id);

-- Every role a person holds today that is not group-wide becomes an HFCL role. Group-wide roles
-- (super_admin, platform_admin, auditor) stay on the user.
INSERT INTO user_entity_role (id, user_id, entity_id, role_key)
SELECT pg_temp.vop_id(), ur."B", e.id, r.key
FROM "_UserRoles" ur
JOIN roles r ON r.id = ur."A"
CROSS JOIN (SELECT id FROM entity WHERE code = 'HFCL') e
WHERE r.key NOT IN ('super_admin', 'platform_admin', 'auditor')
ON CONFLICT (user_id, entity_id, role_key) DO NOTHING;

DELETE FROM "_UserRoles" ur
USING roles r
WHERE r.id = ur."A" AND r.key NOT IN ('super_admin', 'platform_admin', 'auditor');

-- 3. Cases belong to an entity --------------------------------------------------------------------
ALTER TABLE "case" ADD COLUMN IF NOT EXISTS entity_id char(26) REFERENCES entity(id);
UPDATE "case" SET entity_id = (SELECT id FROM entity WHERE code = 'HFCL') WHERE entity_id IS NULL;
ALTER TABLE "case" ALTER COLUMN entity_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS case_entity_id_created_at_idx ON "case" (entity_id, created_at);

-- 4. Access requests name the entity they are for -------------------------------------------------
ALTER TABLE registration_request ADD COLUMN IF NOT EXISTS entity_id char(26) REFERENCES entity(id);

-- 5. Team structure is per entity -----------------------------------------------------------------
ALTER TABLE team_structure_master ADD COLUMN IF NOT EXISTS entity_id char(26) REFERENCES entity(id);
UPDATE team_structure_master SET entity_id = (SELECT id FROM entity WHERE code = 'HFCL') WHERE entity_id IS NULL;
ALTER TABLE team_structure_master ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE team_structure_master DROP CONSTRAINT IF EXISTS team_structure_master_proposer_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS team_structure_master_entity_id_proposer_email_key
  ON team_structure_master (entity_id, proposer_email);

ALTER TABLE team_directory ADD COLUMN IF NOT EXISTS entity_id char(26) REFERENCES entity(id);
UPDATE team_directory SET entity_id = (SELECT id FROM entity WHERE code = 'HFCL') WHERE entity_id IS NULL;
ALTER TABLE team_directory ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE team_directory DROP CONSTRAINT IF EXISTS team_directory_role_key_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS team_directory_entity_id_role_key_email_key
  ON team_directory (entity_id, role_key, email);
CREATE INDEX IF NOT EXISTS team_directory_entity_id_idx ON team_directory (entity_id);

COMMIT;
