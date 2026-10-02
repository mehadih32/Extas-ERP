import { afterEach, describe, expect, it, vi } from "vitest";

import { toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { detectFileType, safeFileName } from "@/modules/files/file.service";
import {
  canonicalSize,
  claudeIntakeParser,
  defaultIntakeParser,
  type IntakeHints,
  matchParsedLines,
  type MatchVariant,
  type ParsedLine,
} from "@/modules/production/ai-intake";
import {
  allocateIntakeCost,
  deliveryCostShare,
  planIntakeCost,
} from "@/modules/production/costing";
import { isStageBackward, projectTimeline, stageBadge } from "@/modules/production/timeline";

const TZ = "Asia/Dhaka";

describe("project timeline", () => {
  const project = {
    startDate: toInstant("2026-01-01", TZ),
    targetDate: toInstant("2026-01-31", TZ),
    completedAt: null,
    status: "ACTIVE" as const,
  };

  it("counts elapsed and remaining days in company time", () => {
    expect(projectTimeline(project, new Date("2026-01-11T06:00:00Z"), TZ)).toEqual({
      startDay: "2026-01-01",
      targetDay: "2026-01-31",
      today: "2026-01-11",
      totalDays: 30,
      elapsedDays: 10,
      remainingDays: 20,
      isOverdue: false,
      overdueDays: 0,
      dueSoon: false,
      health: "ON_TRACK",
      timeElapsedPercent: 33,
    });
  });

  it("flags a project due within a week, then turns it red after the target day", () => {
    expect(projectTimeline(project, new Date("2026-01-25T06:00:00Z"), TZ)).toMatchObject({
      remainingDays: 6,
      dueSoon: true,
      health: "DUE_SOON",
    });
    // 23:59 on 31 Jan in Dhaka: due today, not late.
    expect(projectTimeline(project, new Date("2026-01-31T17:59:00Z"), TZ)).toMatchObject({
      today: "2026-01-31",
      remainingDays: 0,
      isOverdue: false,
    });
    // Midnight in Dhaka (still 31 Jan in UTC): one day overdue.
    expect(projectTimeline(project, new Date("2026-01-31T18:00:00Z"), TZ)).toMatchObject({
      today: "2026-02-01",
      remainingDays: -1,
      isOverdue: true,
      overdueDays: 1,
      dueSoon: false,
      health: "OVERDUE",
      timeElapsedPercent: 100,
    });
  });

  it("stops counting when a project is completed or cancelled", () => {
    const late = projectTimeline(
      { ...project, status: "COMPLETED", completedAt: new Date("2026-02-03T05:00:00Z") },
      new Date("2026-03-15T05:00:00Z"),
      TZ,
    );
    expect(late).toMatchObject({
      elapsedDays: 33,
      remainingDays: null,
      isOverdue: false,
      health: "COMPLETED_LATE",
    });
    const onTime = projectTimeline(
      { ...project, status: "COMPLETED", completedAt: new Date("2026-01-30T05:00:00Z") },
      new Date("2026-03-15T05:00:00Z"),
      TZ,
    );
    expect(onTime.health).toBe("COMPLETED");
    expect(
      projectTimeline({ ...project, status: "CANCELLED" }, new Date("2026-03-15T05:00:00Z"), TZ),
    ).toMatchObject({ health: "CANCELLED", remainingDays: null, isOverdue: false });
  });

  it("does not count days before a planned project starts", () => {
    const planned = {
      ...project,
      status: "PLANNED" as const,
      startDate: toInstant("2026-02-01", TZ),
      targetDate: toInstant("2026-03-01", TZ),
    };
    expect(projectTimeline(planned, new Date("2026-01-20T06:00:00Z"), TZ)).toMatchObject({
      totalDays: 28,
      elapsedDays: 0,
      remainingDays: 40,
      health: "ON_TRACK",
      timeElapsedPercent: 0,
    });
  });

  it("shows the stage badge as step n of 5", () => {
    expect(stageBadge("FABRIC_SOURCING")).toEqual({
      key: "FABRIC_SOURCING",
      label: "Fabric Sourcing",
      number: 1,
      of: 5,
      progressPercent: 0,
    });
    expect(stageBadge("WASH_QC")).toMatchObject({
      label: "Wash/QC",
      number: 4,
      progressPercent: 60,
    });
    expect(stageBadge("COMPLETED")).toMatchObject({ number: 5, progressPercent: 100 });
    expect(isStageBackward("SEWING", "CUTTING")).toBe(true);
    expect(isStageBackward("CUTTING", "SEWING")).toBe(false);
  });
});

describe("delivery costing", () => {
  it("gives a delivery its share of the cost still expected", () => {
    const share = (args: Parameters<typeof deliveryCostShare>[0]) =>
      deliveryCostShare(args).toFixed(2);
    // 300 of the 1,000 pieces still due take 30% of the cost.
    expect(share({ wip: 10000, pieces: 300, received: 0, target: 1000, final: false })).toBe(
      "3000.00",
    );
    // With 700 still due, 350 pieces take half of what is left.
    expect(share({ wip: 7000, pieces: 350, received: 300, target: 1000, final: false })).toBe(
      "3500.00",
    );
    // The final delivery, or one that reaches the target, takes everything left.
    expect(share({ wip: 3500, pieces: 200, received: 650, target: 1000, final: true })).toBe(
      "3500.00",
    );
    expect(share({ wip: 3500, pieces: 400, received: 650, target: 1000, final: false })).toBe(
      "3500.00",
    );
    expect(share({ wip: 0, pieces: 10, received: 0, target: 10, final: true })).toBe("0.00");
  });

  it("splits the cost per piece: equal, B-grade at a ratio, or typed in", () => {
    const lines = [
      { grade: "A_GRADE" as const, quantity: 90 },
      { grade: "B_GRADE" as const, quantity: 10 },
    ];
    const fixed4 = (values: { toFixed(n: number): string }[]) => values.map((v) => v.toFixed(4));
    expect(fixed4(allocateIntakeCost(lines, "EQUAL_PER_PIECE", 1000))).toEqual([
      "10.0000",
      "10.0000",
    ]);
    // B-grade at half: 90 + 5 = 95 cost units, 1000 / 95 per A-grade piece.
    expect(fixed4(allocateIntakeCost(lines, "B_GRADE_RATIO", 1000, 0.5))).toEqual([
      "10.5263",
      "5.2632",
    ]);
    expect(
      fixed4(
        allocateIntakeCost(
          [
            { grade: "A_GRADE", quantity: 5, unitCost: 120.5 },
            { grade: "B_GRADE", quantity: 5, unitCost: 40 },
          ],
          "MANUAL",
          0,
        ),
      ),
    ).toEqual(["120.5000", "40.0000"]);
    expect(() => allocateIntakeCost([{ grade: "A_GRADE", quantity: 5 }], "MANUAL", 0)).toThrow(
      AppError,
    );
    // B-grade valued at zero cannot carry a cost on its own.
    expect(() =>
      allocateIntakeCost([{ grade: "B_GRADE", quantity: 5 }], "B_GRADE_RATIO", 100, 0),
    ).toThrow(AppError);
  });

  it("plans what a delivery moves into stock", () => {
    const lines = [{ grade: "A_GRADE" as const, quantity: 300 }];
    const base = { lines, method: "EQUAL_PER_PIECE" as const, wip: 10000, received: 0 };
    const share = planIntakeCost({ ...base, target: 1000, final: false });
    expect(share.pieces).toBe(300);
    expect(share.total.toFixed(2)).toBe("3000.00");
    expect(share.unitCosts.map((c) => c.toFixed(4))).toEqual(["10.0000"]);
    expect(share.remainingAfter.toFixed(2)).toBe("7000.00");
    expect(share.exceedsRemaining).toBe(false);

    const typed = planIntakeCost({ ...base, target: 1000, final: false, totalOverride: 12000 });
    expect(typed.exceedsRemaining).toBe(true);

    const manual = planIntakeCost({
      ...base,
      lines: [{ grade: "A_GRADE", quantity: 300, unitCost: 9.5 }],
      method: "MANUAL",
      target: 1000,
      final: false,
    });
    expect(manual.total.toFixed(2)).toBe("2850.00");
  });
});

describe("packing-list matching", () => {
  const variants: MatchVariant[] = [
    {
      id: "navy-m",
      sku: "EX-PL-001-NAVY-M",
      styleId: "polo",
      styleCode: "EX-PL-001",
      colorName: "Navy",
      sizeName: "M",
    },
    {
      id: "navy-xxl",
      sku: "EX-PL-001-NAVY-XXL",
      styleId: "polo",
      styleCode: "EX-PL-001",
      colorName: "Navy",
      sizeName: "XXL",
    },
    {
      id: "white-m",
      sku: "EX-PL-001-WHITE-M",
      styleId: "polo",
      styleCode: "EX-PL-001",
      colorName: "White",
      sizeName: "M",
    },
    {
      id: "tee-black-l",
      sku: "EX-TS-002-BLACK-L",
      styleId: "tee",
      styleCode: "EX-TS-002",
      colorName: "Black",
      sizeName: "L",
    },
  ];
  const line = (over: Partial<ParsedLine>): ParsedLine => ({
    sku: null,
    styleCode: null,
    color: null,
    size: null,
    quantity: 1,
    grade: "A_GRADE",
    ...over,
  });

  it("matches by SKU, or style + colour + size, and adds up repeats", () => {
    const result = matchParsedLines(
      [
        line({ sku: "ex-pl-001-navy-m", quantity: 10 }),
        line({ color: "NAVY", size: "Medium", quantity: 5 }), // the project's style
        line({ color: "Navy Blue", size: "2XL", quantity: 7 }), // close colour name, size alias
        line({ styleCode: "EX TS 002", color: "black", size: "l", quantity: 4, grade: "B_GRADE" }),
        line({ styleCode: "EX-ZZ-999", color: "Red", size: "M", quantity: 3 }),
        line({ color: "Green", size: "M", quantity: 2 }),
        line({ color: "White", quantity: 1 }),
      ],
      variants,
      "polo",
    );
    expect(result.lines).toEqual([
      { variantId: "navy-m", grade: "A_GRADE", quantity: 15 },
      { variantId: "navy-xxl", grade: "A_GRADE", quantity: 7 },
      { variantId: "tee-black-l", grade: "B_GRADE", quantity: 4 },
    ]);
    expect(result.unmatched.map((u) => [u.quantity, u.reason])).toEqual([
      [3, "Style EX-ZZ-999 is not in the catalog"],
      [2, "Green / M is not in this style's matrix"],
      [1, "Colour or size is missing"],
    ]);
    // Without a project style, a line must name its style or SKU.
    expect(
      matchParsedLines([line({ color: "Navy", size: "M" })], variants, null).unmatched[0]?.reason,
    ).toBe("No style on this line");
  });

  it("reads printed sizes the way the catalog names them", () => {
    expect(
      ["Small", "med", "Extra Large", "2XL", "xxxl", "XXXXL", "38"].map(canonicalSize),
    ).toEqual(["S", "M", "XL", "XXL", "3XL", "4XL", "38"]);
  });
});

describe("AI packing-list reader", () => {
  const file = {
    bytes: Buffer.from("%PDF-1.7 packing list"),
    mimeType: "application/pdf",
    fileName: "pl.pdf",
  };
  const hints: IntakeHints = {
    projectStyle: { code: "EX-PL-001", name: "Classic Polo" },
    styleCodes: ["EX-PL-001"],
    colors: ["Navy", "White"],
    sizes: ["S", "M", "L"],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends the file to the Claude API and reads the recorded lines", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        model: "reader-model",
        content: [
          {
            type: "tool_use",
            name: "record_packing_list",
            input: {
              lines: [
                { style_code: "EX-PL-001", color: "Navy", size: "M", quantity: 120 },
                { sku: " EX-PL-001-NAVY-S ", quantity: 8, grade: "B" },
                { color: "Navy", size: "L", quantity: 0 },
              ],
              confidence: 0.92,
              notes: "Carton 7 is smudged",
            },
          },
        ],
      }),
    );
    const parser = claudeIntakeParser({ apiKey: "test-key", model: "reader-model", fetchImpl });
    expect(await parser.parse(file, hints)).toEqual({
      lines: [
        {
          sku: null,
          styleCode: "EX-PL-001",
          color: "Navy",
          size: "M",
          quantity: 120,
          grade: "A_GRADE",
        },
        {
          sku: "EX-PL-001-NAVY-S",
          styleCode: null,
          color: null,
          size: null,
          quantity: 8,
          grade: "B_GRADE",
        },
      ],
      confidence: 0.92,
      notes: "Carton 7 is smudged",
      model: "reader-model",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "reader-model",
      tool_choice: { type: "tool", name: "record_packing_list" },
    });
    expect(body.messages[0].content[0]).toMatchObject({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: file.bytes.toString("base64"),
      },
    });
    expect(body.messages[0].content[1].text).toContain("style EX-PL-001 (Classic Polo)");
  });

  it("explains failures so the delivery can be typed in instead", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = (response: Response) =>
      claudeIntakeParser({
        apiKey: "k",
        model: "m",
        fetchImpl: vi.fn<typeof fetch>(async () => response),
      });

    await expect(
      reply(new Response("{}", { status: 401 })).parse(file, hints),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("AI_API_KEY"),
    });
    await expect(
      reply(new Response("{}", { status: 404 })).parse(file, hints),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("AI_INTAKE_MODEL"),
    });
    const noLines = reply(Response.json({ content: [{ type: "text", text: "Sorry" }] }));
    await expect(noLines.parse(file, hints)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const bigPhoto = { ...file, mimeType: "image/jpeg", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) };
    await expect(noLines.parse(bigPhoto, hints)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("is switched on only when both the key and the model are configured", () => {
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubEnv("AI_INTAKE_MODEL", "");
    expect(defaultIntakeParser()).toBeNull();
    vi.stubEnv("AI_INTAKE_MODEL", "m");
    expect(defaultIntakeParser()).not.toBeNull();
    vi.stubEnv("AI_API_KEY", "");
    expect(defaultIntakeParser()).toBeNull();
  });
});

describe("uploads", () => {
  it("judges the file type by its first bytes, not its name", () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toEqual({
      mimeType: "image/jpeg",
      ext: ".jpg",
    });
    expect(
      detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mimeType,
    ).toBe("image/png");
    expect(detectFileType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))?.mimeType).toBe("image/webp");
    expect(detectFileType(Buffer.from("%PDF-1.7\n"))?.mimeType).toBe("application/pdf");
    expect(detectFileType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectFileType(Buffer.from([0x4d, 0x5a, 0x90, 0]))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });

  it("keeps a safe display name", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\packing list (3).jpg")).toBe("packing list (3).jpg");
    expect(safeFileName('bad"<name>|?.pdf')).toBe("badname.pdf");
    expect(safeFileName("   ")).toBe("upload");
  });
});
