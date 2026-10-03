import type { ReminderRule, ReminderType } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";
import { updateRuleSchema } from "@/modules/reminders/schemas";

/*
 * Automatic reminders: when a date comes near, the people who can act on it hear
 * about it in the app, a few days before, on the day and again while it is
 * overdue. Each company can change the days, the time they go out and who is
 * told, per kind of date; without changes these defaults apply.
 */

export const AUTO_TYPES = [
  "PRODUCTION_DEADLINE",
  "GOODS_IN_HOUSE",
  "SHIPMENT",
  "COMPLIANCE_EXPIRY",
  "TASK_DUE",
] as const satisfies readonly ReminderType[];

export type AutoType = (typeof AUTO_TYPES)[number];

export const isAutoType = (type: string): type is AutoType =>
  (AUTO_TYPES as readonly string[]).includes(type);

export type RuleSettings = {
  type: AutoType;
  isActive: boolean;
  /** Days before the date, largest first ([7, 3, 1, 0]: a week, 3 days, a day before and on the day). */
  daysBefore: number[];
  /** Remind again every this many days once the date has passed (0 = never). */
  overdueEveryDays: number;
  /** "09:00", company time. */
  sendTime: string;
  notifyManagers: boolean;
  notifyOwner: boolean;
  userIds: string[];
  employeeIds: string[];
};

type Defaults = Omit<RuleSettings, "type" | "userIds" | "employeeIds">;

export const DEFAULT_RULES: Record<AutoType, Defaults> = {
  PRODUCTION_DEADLINE: {
    isActive: true,
    daysBefore: [7, 3, 1, 0],
    overdueEveryDays: 3,
    sendTime: "09:00",
    notifyManagers: true,
    notifyOwner: true,
  },
  GOODS_IN_HOUSE: {
    isActive: true,
    daysBefore: [3, 1, 0],
    overdueEveryDays: 2,
    sendTime: "09:00",
    notifyManagers: true,
    notifyOwner: true,
  },
  SHIPMENT: {
    isActive: true,
    daysBefore: [7, 3, 1, 0],
    overdueEveryDays: 1,
    sendTime: "09:00",
    notifyManagers: true,
    notifyOwner: true,
  },
  // The first alert comes when the licence's own renewal window opens (alertDaysBefore).
  COMPLIANCE_EXPIRY: {
    isActive: true,
    daysBefore: [15, 7, 1, 0],
    overdueEveryDays: 7,
    sendTime: "09:00",
    notifyManagers: true,
    notifyOwner: true,
  },
  TASK_DUE: {
    isActive: true,
    daysBefore: [1, 0],
    overdueEveryDays: 1,
    sendTime: "09:00",
    notifyManagers: false,
    notifyOwner: true,
  },
};

export const RULE_INFO: Record<
  AutoType,
  { label: string; managers: PermissionKey[]; owner: string; date: string }
> = {
  PRODUCTION_DEADLINE: {
    label: "Production deadlines",
    managers: ["production.manage"],
    owner: "(none)",
    date: "the project's target date (planned and active projects)",
  },
  GOODS_IN_HOUSE: {
    label: "Goods in-house",
    managers: ["materials.purchase"],
    owner: "who raised the purchase order",
    date: "a purchase order's expected date, until everything has arrived",
  },
  SHIPMENT: {
    label: "Shipments",
    managers: ["sales.order.create"],
    owner: "(none)",
    date: "a sales order's shipment date, until it is delivered",
  },
  COMPLIANCE_EXPIRY: {
    label: "Licence and registration renewals",
    managers: ["compliance.manage", "compliance.view"],
    owner: "(none)",
    date: "the expiry date, from the record's own alert days before it",
  },
  TASK_DUE: {
    label: "Task due dates",
    managers: [],
    owner: "the task's assignee and who created it",
    date: "the task's due date, until it is done",
  },
};

function settingsOf(type: AutoType, row: ReminderRule | undefined): RuleSettings {
  const defaults = DEFAULT_RULES[type];
  if (!row)
    return {
      type,
      ...defaults,
      daysBefore: [...defaults.daysBefore],
      userIds: [],
      employeeIds: [],
    };
  return {
    type,
    isActive: row.isActive,
    daysBefore: [...row.daysBefore].sort((a, b) => b - a),
    overdueEveryDays: row.overdueEveryDays,
    sendTime: row.sendTime,
    notifyManagers: row.notifyManagers,
    notifyOwner: row.notifyOwner,
    userIds: row.userIds,
    employeeIds: row.employeeIds,
  };
}

/** The settings in force for every kind of automatic reminder in a company. */
export async function loadRules(companyId: string, db: Db = prisma) {
  const rows = await db.reminderRule.findMany({ where: { companyId } });
  return Object.fromEntries(
    AUTO_TYPES.map((type) => [
      type,
      settingsOf(
        type,
        rows.find((r) => r.type === type),
      ),
    ]),
  ) as Record<AutoType, RuleSettings>;
}

/**
 * Which step of a rule is due for a date `daysLeft` days away (negative when it
 * has passed), or null when none is. Before the date it is the latest of the
 * listed days already reached, so a reminder missed while the server was off,
 * or a record added inside the window, fires once rather than once per step.
 * After the date it repeats every `overdueEveryDays` days.
 */
export function dueStep(
  daysLeft: number,
  daysBefore: readonly number[],
  overdueEveryDays: number,
): { key: string; offset: number } | null {
  if (daysLeft >= 0) {
    const reached = daysBefore.filter((d) => d >= daysLeft);
    if (reached.length === 0) return null;
    const offset = Math.min(...reached);
    return { key: `d${offset}`, offset };
  }
  if (overdueEveryDays <= 0) return null;
  const round = Math.floor((-daysLeft - 1) / overdueEveryDays);
  return { key: `late${round}`, offset: -(1 + round * overdueEveryDays) };
}

/** A licence's steps: its own first alert, then the rule's days that come after it. */
export function complianceSteps(ruleDays: readonly number[], alertDaysBefore: number): number[] {
  return [...new Set([alertDaysBefore, ...ruleDays.filter((d) => d < alertDaysBefore)])].sort(
    (a, b) => b - a,
  );
}

function present(settings: RuleSettings, customised: boolean) {
  const info = RULE_INFO[settings.type];
  return {
    ...settings,
    label: info.label,
    /** Holders of any of these permissions hear about it when notifyManagers is on. */
    managerPermissions: info.managers,
    owner: info.owner,
    date: info.date,
    /** False while the company uses the defaults. */
    customised,
  };
}

/** The automatic reminder settings, with what each kind watches and who hears about it. */
export async function listRules(ctx: CompanyContext) {
  const rows = await ctx.db.reminderRule.findMany();
  return AUTO_TYPES.map((type) => {
    const row = rows.find((r) => r.type === type);
    return present(settingsOf(type, row), Boolean(row));
  });
}

/** Changes one kind of automatic reminder (company.settings). */
export async function updateRule(
  ctx: CompanyContext,
  type: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!isAutoType(type))
    throw new AppError("NOT_FOUND", "There are no automatic reminders of this kind.");
  const input = updateRuleSchema.parse(raw);
  const rows = await ctx.db.reminderRule.findMany({ where: { type } });
  const current = settingsOf(type, rows[0]);

  if (input.userIds) {
    const members = await prisma.companyMembership.count({
      where: {
        companyId: ctx.company.id,
        userId: { in: input.userIds },
        isActive: true,
        user: { status: { not: "SUSPENDED" } },
      },
    });
    if (members !== input.userIds.length) {
      throw new AppError(
        "VALIDATION",
        "Some of these people are not active users of this company.",
        {
          userIds: ["Pick active users of this company"],
        },
      );
    }
  }
  if (input.employeeIds) {
    const staff = await ctx.db.employee.count({
      where: { id: { in: input.employeeIds }, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    });
    if (staff !== input.employeeIds.length) {
      throw new AppError("VALIDATION", "Some of these employees were not found.", {
        employeeIds: ["Pick current employees of this company"],
      });
    }
  }

  const next: RuleSettings = {
    ...current,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    type,
  };
  next.daysBefore = [...new Set(next.daysBefore)].sort((a, b) => b - a);
  const data = {
    isActive: next.isActive,
    daysBefore: next.daysBefore,
    overdueEveryDays: next.overdueEveryDays,
    sendTime: next.sendTime,
    notifyManagers: next.notifyManagers,
    notifyOwner: next.notifyOwner,
    userIds: next.userIds,
    employeeIds: next.employeeIds,
    updatedById: ctx.user.id,
  };
  await ctx.db.reminderRule.upsert({
    where: { companyId_type: { companyId: ctx.company.id, type } },
    create: { companyId: ctx.company.id, type, ...data },
    update: data,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ReminderRule",
    entityId: type,
    summary: `Automatic reminders for ${RULE_INFO[type].label.toLowerCase()}: ${
      next.isActive
        ? `${next.daysBefore.join(", ")} days before at ${next.sendTime}, then every ${next.overdueEveryDays} days overdue`
        : "turned off"
    }`,
    before: { ...current },
    after: { ...next },
  });
  return present(next, true);
}
