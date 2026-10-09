import type { AdvanceStatus, EmployeeStatus, LeaveStatus } from "@prisma/client";

import { ADVANCE_STATUSES, EMPLOYEE_STATUSES, LEAVE_STATUSES } from "./labels";

/*
 * The HR lists' filters, kept in the address bar so a refresh or a shared link
 * shows the same list: "/hr/employees?department=Cutting&former=1". Empty
 * filters stay out of the address; anything malformed is ignored.
 */

/** Rows shown at first and per "Show more". */
export const HR_PAGE_SIZE = 30;

export type EmployeeListView = {
  list: "employees";
  /** Name, code, phone or designation. */
  q: string;
  department?: string;
  status?: EmployeeStatus;
  /** People who left too. */
  former?: boolean;
};

export type LeaveListView = {
  list: "leave";
  status?: LeaveStatus;
  type?: string;
  employee?: string;
};

export type AdvanceListView = { list: "advances"; status?: AdvanceStatus; employee?: string };

export type HrListView = EmployeeListView | LeaveListView | AdvanceListView;

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

/** A record id from the address (letters, digits, dashes), or undefined. */
const idParam = (value: string) => (/^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined);
const flag = (params: SearchParams, key: string) => one(params, key) === "1" || undefined;

export function employeeViewFrom(params: SearchParams): EmployeeListView {
  return {
    list: "employees",
    q: one(params, "q").slice(0, 100),
    department: one(params, "department").slice(0, 80) || undefined,
    status: pick(EMPLOYEE_STATUSES, one(params, "status")),
    former: flag(params, "former"),
  };
}

export function leaveViewFrom(params: SearchParams): LeaveListView {
  return {
    list: "leave",
    status: pick(LEAVE_STATUSES, one(params, "status")),
    type: idParam(one(params, "type")),
    employee: idParam(one(params, "employee")),
  };
}

export function advanceViewFrom(params: SearchParams): AdvanceListView {
  return {
    list: "advances",
    status: pick(ADVANCE_STATUSES, one(params, "status")),
    employee: idParam(one(params, "employee")),
  };
}

/** The address-bar query for these filters: "?status=PENDING", or "" when none are set. */
export function hrListSearch(view: HrListView): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | boolean | undefined) => {
    if (value === true) params.set(key, "1");
    else if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  };
  switch (view.list) {
    case "employees":
      set("q", view.q);
      set("department", view.department);
      set("status", view.status);
      set("former", view.former);
      break;
    case "leave":
      set("status", view.status);
      set("type", view.type);
      set("employee", view.employee);
      break;
    case "advances":
      set("status", view.status);
      set("employee", view.employee);
      break;
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isHrFiltered(view: HrListView): boolean {
  return hrListSearch(view) !== "";
}

/** The same view with its filters cleared. */
export function clearedHrView<T extends HrListView>(view: T): T {
  return (view.list === "employees" ? { list: view.list, q: "" } : { list: view.list }) as T;
}

export function employeeListQuery(view: EmployeeListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    department: view.department,
    status: view.status,
    former: view.former,
    cursor,
    take: HR_PAGE_SIZE,
  };
}

export function leaveListQuery(view: LeaveListView, cursor?: string) {
  return {
    status: view.status,
    leaveTypeId: view.type,
    employeeId: view.employee,
    cursor,
    take: HR_PAGE_SIZE,
  };
}

export function advanceListQuery(view: AdvanceListView, cursor?: string) {
  return { status: view.status, employeeId: view.employee, cursor, take: HR_PAGE_SIZE };
}
