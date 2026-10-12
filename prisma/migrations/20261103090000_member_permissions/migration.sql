-- The permission matrix (Settings > Team): one person's changes to what their
-- role gives them. A new, empty table; nobody's access changes until an admin
-- ticks or unticks something for them.

-- CreateTable
CREATE TABLE "MemberPermission" (
    "membershipId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "MemberPermission_pkey" PRIMARY KEY ("membershipId","permissionId")
);

-- CreateIndex
CREATE INDEX "MemberPermission_permissionId_idx" ON "MemberPermission"("permissionId");

-- AddForeignKey
ALTER TABLE "MemberPermission" ADD CONSTRAINT "MemberPermission_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPermission" ADD CONSTRAINT "MemberPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
