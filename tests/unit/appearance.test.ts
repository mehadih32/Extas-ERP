import { describe, expect, it } from "vitest";

import { sidebarModeFrom } from "@/components/shell/sidebar-state";
import { appearanceSchema, INTERFACE_STYLES } from "@/modules/appearance/appearance.service";

describe("the look of the app", () => {
  it("is Legacy or Modern, and nothing else", () => {
    expect(INTERFACE_STYLES).toEqual(["LEGACY", "MODERN"]);
    expect(appearanceSchema.parse({ interfaceStyle: "MODERN" })).toEqual({
      interfaceStyle: "MODERN",
    });
    expect(appearanceSchema.safeParse({ interfaceStyle: "modern" }).success).toBe(false);
    expect(appearanceSchema.safeParse({}).success).toBe(false);
  });

  it("remembers the side menu's width per device, and decides by screen size until then", () => {
    expect(sidebarModeFrom("collapsed")).toBe("collapsed");
    expect(sidebarModeFrom("expanded")).toBe("expanded");
    expect(sidebarModeFrom(undefined)).toBe("auto");
    expect(sidebarModeFrom("wide")).toBe("auto");
  });
});
