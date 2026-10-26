-- Structured vendor address on the vendor master (case_general). Asked on the intake form when the
-- vendor's PAN has no GST registration (otherwise it comes from the GST registry).
-- Additive and idempotent; apply with: prisma db execute --file prisma/sql/0003-vendor-address.sql
ALTER TABLE case_general ADD COLUMN IF NOT EXISTS address_country     text;
ALTER TABLE case_general ADD COLUMN IF NOT EXISTS address_state       text;
ALTER TABLE case_general ADD COLUMN IF NOT EXISTS address_city        text;
ALTER TABLE case_general ADD COLUMN IF NOT EXISTS address_postal_code text;
