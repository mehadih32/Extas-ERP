-- The staff money drill-down (HR > Money): a new permission. No role gets it
-- by default; Super Admins hold every permission, and a role or a person can
-- be given it in Settings.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'hr.money.view', 'HR',
   'See the staff money drill-down: salary, conveyance, bonus and overtime by person and by day')
ON CONFLICT ("key") DO NOTHING;
