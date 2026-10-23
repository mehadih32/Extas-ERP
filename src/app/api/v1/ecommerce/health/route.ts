import { ecommerceRoute } from "@/modules/ecommerce/route";

/** GET /api/v1/ecommerce/health: whether the key works, and whose it is. */
export const GET = ecommerceRoute(async ({ integration }) => ({
  ok: true,
  company: { name: integration.company.name },
  integration: {
    id: integration.id,
    name: integration.name,
    platform: integration.platform,
    warehouseId: integration.warehouseId,
  },
  serverTime: new Date().toISOString(),
}));
