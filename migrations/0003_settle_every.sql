-- Tabs can be settled repeatedly: pay what's owed every week or month from settle_on.
ALTER TABLE plans ADD COLUMN settle_every TEXT;
