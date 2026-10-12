import { describe, expect, it } from "vitest";

import { telHref, whatsappHref } from "@/components/hr/contact-links";
import { initials } from "@/components/hr/employee-avatar";
import { shortTenureText, tenureOn } from "@/modules/hr/tenure";

/*
 * The employee directory's small pieces: time here in its short form, the
 * initials shown without a photo, and the WhatsApp and call links by a name.
 */

describe("time here, short", () => {
  const short = (joined: string, day: string) => shortTenureText(tenureOn(joined, day));

  it("gives years and months, then months, then days", () => {
    expect(short("2024-07-01", "2026-10-12")).toBe("2 yrs 3 mos");
    expect(short("2025-10-12", "2026-10-12")).toBe("1 yr");
    expect(short("2025-09-01", "2026-10-12")).toBe("1 yr 1 mo");
    expect(short("2026-05-12", "2026-10-12")).toBe("5 mos");
    expect(short("2026-09-12", "2026-10-12")).toBe("1 mo");
    expect(short("2026-10-02", "2026-10-12")).toBe("10 days");
    expect(short("2026-10-11", "2026-10-12")).toBe("1 day");
    expect(short("2026-10-12", "2026-10-12")).toBe("Joined today");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two names", () => {
    expect(initials("Sumon Mia")).toBe("SM");
    expect(initials("  md. rafiqul   islam ")).toBe("MR");
    expect(initials("Rahim")).toBe("R");
  });
});

describe("contact links", () => {
  it("opens WhatsApp on the WhatsApp number, else the phone, with 880 for local numbers", () => {
    expect(whatsappHref("01811 222333", "01712345678")).toBe("https://wa.me/8801811222333");
    expect(whatsappHref(null, "01712-345678")).toBe("https://wa.me/8801712345678");
    expect(whatsappHref("+880 1712 345678")).toBe("https://wa.me/8801712345678");
    expect(whatsappHref("12", null)).toBeNull();
    expect(whatsappHref(null, null)).toBeNull();
  });

  it("dials the number as typed, keeping only digits and a leading +", () => {
    expect(telHref("01712-345678")).toBe("tel:01712345678");
    expect(telHref("+880 1712 345678")).toBe("tel:+8801712345678");
    expect(telHref("+88+017")).toBe("tel:+88017");
    expect(telHref("ext")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
