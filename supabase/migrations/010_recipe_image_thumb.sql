-- A tiny 320px webp beside every hero image, so list avatars don't download
-- the full ~1200px hero. Null on recipes captured before thumbs existed;
-- GET /api/admin/backfill-thumbs fills those in. (This column was first added
-- by hand in the SQL editor — recorded here so a fresh install matches.)
alter table recipes add column if not exists image_thumb_url text;
