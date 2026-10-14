-- Bookings get their own permissions, so a role or one person can be given only
-- part of them (Settings, the access tree: Production > Bookings). Until now
-- bookings were seen with production.view, materials.view or materials.purchase,
-- made, changed, closed and cancelled with materials.purchase, and attached to a
-- batch with materials.purchase or production.manage. Everyone keeps exactly
-- what they had: each new permission goes to the roles, and to the people, that
-- held what gave it before. No other permission changes.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'production.bookings.view', 'PRODUCTION',
   'See fabric and trims bookings, their terms and the PDF (prices need materials.purchase, production.manage or accounts.view)'),
  (gen_random_uuid()::text, 'production.bookings.supplier', 'PRODUCTION',
   'Make and change supplier PO bookings (a mill or trims house makes the goods)'),
  (gen_random_uuid()::text, 'production.bookings.market', 'PRODUCTION',
   'Make and change ready stock bookings bought on the market (adding them to stock as they are saved also needs materials.purchase)'),
  (gen_random_uuid()::text, 'production.bookings.attach', 'PRODUCTION',
   'Attach bookings to a master batch and take them off'),
  (gen_random_uuid()::text, 'production.bookings.close', 'PRODUCTION',
   'Close or cancel bookings')
ON CONFLICT ("key") DO NOTHING;

-- What gave each new permission before.
CREATE TEMPORARY TABLE "_BookingGrant" ("newKey" TEXT NOT NULL, "oldKey" TEXT NOT NULL);
INSERT INTO "_BookingGrant" ("newKey", "oldKey")
VALUES
  ('production.bookings.view', 'production.view'),
  ('production.bookings.view', 'materials.view'),
  ('production.bookings.view', 'materials.purchase'),
  ('production.bookings.supplier', 'materials.purchase'),
  ('production.bookings.market', 'materials.purchase'),
  ('production.bookings.attach', 'materials.purchase'),
  ('production.bookings.attach', 'production.manage'),
  ('production.bookings.close', 'materials.purchase');

-- People whose own changes (MemberPermission) touch the old permissions: what
-- they held before and what their role held, worked out before the roles change.
CREATE TEMPORARY TABLE "_BookingMember" AS
WITH role_keys AS (
  SELECT rp."roleId", p."key"
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
),
own_changes AS (
  SELECT mp."membershipId", p."key", mp."granted"
  FROM "MemberPermission" mp
  JOIN "Permission" p ON p."id" = mp."permissionId"
),
changed AS (
  SELECT DISTINCT m."id", m."roleId"
  FROM "CompanyMembership" m
  JOIN own_changes c ON c."membershipId" = m."id"
  JOIN "_BookingGrant" g ON g."oldKey" = c."key"
),
held AS (
  -- The role's permissions not taken away from them, and the ones added for them.
  SELECT m."id" AS "membershipId", rk."key"
  FROM changed m
  JOIN role_keys rk ON rk."roleId" = m."roleId"
  WHERE NOT EXISTS (
    SELECT 1 FROM own_changes c
    WHERE c."membershipId" = m."id" AND c."key" = rk."key" AND NOT c."granted"
  )
  UNION
  SELECT c."membershipId", c."key"
  FROM own_changes c
  JOIN changed m ON m."id" = c."membershipId"
  WHERE c."granted"
)
SELECT m."id" AS "membershipId", n."newKey",
  EXISTS (
    SELECT 1 FROM "_BookingGrant" g
    JOIN held h ON h."key" = g."oldKey"
    WHERE g."newKey" = n."newKey" AND h."membershipId" = m."id"
  ) AS "wanted",
  EXISTS (
    SELECT 1 FROM "_BookingGrant" g
    JOIN role_keys rk ON rk."key" = g."oldKey"
    WHERE g."newKey" = n."newKey" AND rk."roleId" = m."roleId"
  ) AS "fromRole"
FROM changed m
CROSS JOIN (SELECT DISTINCT "newKey" FROM "_BookingGrant") n;

-- Roles: the new permissions go to every role holding what gave them.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM "RolePermission" rp
JOIN "Permission" op ON op."id" = rp."permissionId"
JOIN "_BookingGrant" g ON g."oldKey" = op."key"
JOIN "Permission" np ON np."key" = g."newKey"
ON CONFLICT DO NOTHING;

-- People: where their own changes made their access differ from their role's,
-- the new permission is added for them or taken away from them the same way.
INSERT INTO "MemberPermission" ("membershipId", "permissionId", "granted")
SELECT b."membershipId", p."id", b."wanted"
FROM "_BookingMember" b
JOIN "Permission" p ON p."key" = b."newKey"
WHERE b."wanted" <> b."fromRole"
ON CONFLICT DO NOTHING;

DROP TABLE "_BookingMember";
DROP TABLE "_BookingGrant";
