import type {
  AdvanceStatus,
  AttendanceStatus,
  EmployeeStatus,
  LeaveStatus,
  PayrollStatus,
} from "@prisma/client";

import { StatusBadge, type Tone } from "@/components/sales/badges";

import {
  ADVANCE_STATUS_LABELS,
  EMPLOYEE_STATUS_LABELS,
  LEAVE_STATUS_LABELS,
  MARK_LABELS,
  PAYROLL_STATUS_LABELS,
} from "./labels";

const EMPLOYEE_TONES: Record<EmployeeStatus, Tone> = {
  ACTIVE: "open",
  ON_LEAVE: "plain",
  RESIGNED: "closed",
  TERMINATED: "closed",
};

export function EmployeeBadge({ status }: { status: EmployeeStatus }) {
  return <StatusBadge tone={EMPLOYEE_TONES[status]}>{EMPLOYEE_STATUS_LABELS[status]}</StatusBadge>;
}

const LEAVE_TONES: Record<LeaveStatus, Tone> = {
  PENDING: "warn",
  APPROVED: "done",
  REJECTED: "closed",
  CANCELLED: "closed",
};

export function LeaveBadge({ status }: { status: LeaveStatus }) {
  return <StatusBadge tone={LEAVE_TONES[status]}>{LEAVE_STATUS_LABELS[status]}</StatusBadge>;
}

const PAYROLL_TONES: Record<PayrollStatus, Tone> = {
  DRAFT: "plain",
  APPROVED: "open",
  PAID: "done",
};

export function PayrollBadge({ status }: { status: PayrollStatus }) {
  return <StatusBadge tone={PAYROLL_TONES[status]}>{PAYROLL_STATUS_LABELS[status]}</StatusBadge>;
}

const ADVANCE_TONES: Record<AdvanceStatus, Tone> = {
  OPEN: "open",
  SETTLED: "done",
  VOID: "closed",
};

export function AdvanceBadge({ status }: { status: AdvanceStatus }) {
  return <StatusBadge tone={ADVANCE_TONES[status]}>{ADVANCE_STATUS_LABELS[status]}</StatusBadge>;
}

const MARK_TONES: Record<AttendanceStatus, Tone> = {
  PRESENT: "open",
  LATE: "warn",
  HALF_DAY: "warn",
  ABSENT: "warn",
};

export function MarkBadge({ status }: { status: AttendanceStatus }) {
  return <StatusBadge tone={MARK_TONES[status]}>{MARK_LABELS[status]}</StatusBadge>;
}

/** Former employee, brought forward, unpaid leave: a short plain or warning mark. */
export function FlagBadge({
  tone = "plain",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}
