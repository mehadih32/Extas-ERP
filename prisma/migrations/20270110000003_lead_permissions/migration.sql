-- The lead permissions (Sales > Leads, 2026-11-12): live sites only run migrations, so the
-- Permission rows come here; the built-in Sales Executive role gets see, add and make buyer.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'leads.view', 'SALES', 'See leads given to you and leads not given to anyone yet'),
  (gen_random_uuid()::text, 'leads.all', 'SALES', 'See every lead, whoever follows it up'),
  (gen_random_uuid()::text, 'leads.manage', 'SALES', 'Add and edit leads, their contacts, history, samples and next steps'),
  (gen_random_uuid()::text, 'leads.assign', 'SALES', 'Give leads to other people'),
  (gen_random_uuid()::text, 'leads.convert', 'SALES', 'Make a lead a buyer (also needs adding buyers)'),
  (gen_random_uuid()::text, 'leads.export', 'SALES', 'Download the lead list (logged)'),
  (gen_random_uuid()::text, 'leads.settings', 'SALES', 'Set lead sources and the lead check rules'),
  (gen_random_uuid()::text, 'leads.erase', 'SALES', 'Erase a lead contact''s personal data (needs the PIN)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('leads.view', 'leads.manage', 'leads.convert')
WHERE r."systemRole" IN ('SALES_EXECUTIVE')
ON CONFLICT DO NOTHING;
