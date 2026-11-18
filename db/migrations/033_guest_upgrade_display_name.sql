-- A guest's pending account link can carry the display name the guest chose on the account step. It is applied when the
-- link is used (db/auth.js completeGuestUpgrade); a NULL keeps the guest's current name. Additive and nullable, so an
-- older app version that does not read the column keeps working.
ALTER TABLE guest_upgrades ADD COLUMN IF NOT EXISTS display_name VARCHAR(32);
