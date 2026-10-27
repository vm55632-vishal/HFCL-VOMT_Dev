-- Management structure depends on the vendor's type of constitution: the proprietor of a sole
-- proprietorship, partners of a firm, directors of a company or the Karta of an HUF.
-- Additive and idempotent.

ALTER TABLE case_general ADD COLUMN IF NOT EXISTS constitution text;

ALTER TABLE partner_details ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'partner';
ALTER TABLE partner_details ADD COLUMN IF NOT EXISTS residence_phone_enc text;
ALTER TABLE partner_details ADD COLUMN IF NOT EXISTS contact_enc text;
ALTER TABLE partner_details ADD COLUMN IF NOT EXISTS office_address_enc text;
-- A proprietor / Karta gives a residence phone instead of a personal mobile.
ALTER TABLE partner_details ALTER COLUMN mobile_enc DROP NOT NULL;
