import { describe, expect, it } from "vitest";

import { attempts, PICTURE_OPTIONS, shrinkWith } from "@/lib/compress-image";
import { canEditProformaDetails, isProformaExpired } from "@/modules/sales/rules";

describe("quotation reference pictures", () => {
  it("are redrawn at most 1400 pixels on the long side, aiming at 150 KB", async () => {
    expect(PICTURE_OPTIONS).toEqual({ target: 150 * 1024, maxSide: 1400, jpegOnly: true });
    expect(attempts(4000, 3000, PICTURE_OPTIONS.maxSide)[0]).toEqual({
      width: 1400,
      height: 1050,
      quality: 0.82,
    });
    const sizes: number[] = [];
    await shrinkWith(
      async ({ width }) => {
        sizes.push(width);
        return new Blob([new Uint8Array(100 * 1024)]);
      },
      4000,
      3000,
      PICTURE_OPTIONS.target,
      PICTURE_OPTIONS.maxSide,
    );
    expect(sizes).toEqual([1400]);
  });
});

describe("a proforma's validity and details", () => {
  const issued = { number: "PI-2026-00001", status: "ISSUED" as const };

  it("is expired only after its last day, while the advance is still awaited", () => {
    const pi = { status: "ISSUED" as const, validUntil: "2026-10-25" };
    expect(isProformaExpired(pi, "2026-10-25")).toBe(false);
    expect(isProformaExpired(pi, "2026-10-26")).toBe(true);
    expect(isProformaExpired({ ...pi, validUntil: null }, "2027-01-01")).toBe(false);
    for (const status of ["ADVANCE_RECEIVED", "IN_PRODUCTION", "CONVERTED", "CANCELLED"] as const) {
      expect(isProformaExpired({ ...pi, status }, "2026-10-26")).toBe(false);
    }
  });

  it("keeps the details of a converted or cancelled proforma as printed", () => {
    expect(canEditProformaDetails(issued).ok).toBe(true);
    expect(canEditProformaDetails({ ...issued, status: "IN_PRODUCTION" }).ok).toBe(true);
    expect(canEditProformaDetails({ ...issued, status: "CONVERTED" })).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "PI-2026-00001 is converted; its details are kept as printed.",
    });
    expect(canEditProformaDetails({ ...issued, status: "CANCELLED" }).ok).toBe(false);
  });
});
