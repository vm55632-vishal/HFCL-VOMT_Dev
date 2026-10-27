-- Files tab: where a document was uploaded from, and the uploader's comment. Additive + idempotent.
ALTER TABLE document ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE document ADD COLUMN IF NOT EXISTS comment text;
