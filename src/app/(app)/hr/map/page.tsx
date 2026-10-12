import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { StaffMap } from "@/components/hr/staff-map";
import { Panel } from "@/components/sales/detail-bits";
import { formatCount, formatLongDay } from "@/lib/display";
import { distanceText } from "@/modules/hr/geo";
import type { StaffMapScreen } from "@/modules/hr/location.service";
import { getStaffMapScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Staff map" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

type Row = StaffMapScreen["rows"][number];

function StateBadge({ row }: { row: Row }) {
  if (row.state === "NO_SIGNAL") {
    return <FlagBadge tone="warn">No signal since {row.quietSince}</FlagBadge>;
  }
  if (row.state === "CHECKED_OUT") {
    return <FlagBadge tone="closed">Checked out at {row.checkOut?.time}</FlagBadge>;
  }
  return <FlagBadge tone="done">On duty</FlagBadge>;
}

/** "In at 09:02 at Head office", "In at 09:02, 2.4 km from Factory". */
function checkInText(row: Row) {
  const c = row.checkIn;
  const at = `In at ${c.time}`;
  if (!c.located) return `${at}, no location`;
  if (!c.placeName || c.distance === null) return at;
  return c.away
    ? `${at}, ${distanceText(c.distance)} from ${c.placeName}`
    : `${at} at ${c.placeName}`;
}

/**
 * Where checked-in staff are now (HR, hr.manage): everyone who checked in
 * themselves today (and anyone still on a shift from last night), where they
 * checked in, where their phone was last, and who has sent nothing for a
 * while. Choosing a person shows their route for the shift.
 */
export default async function StaffMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const person = one((await searchParams).person) ?? null;
  const result = await getStaffMapScreenAction({ person: person ?? undefined });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Staff map" heading="The staff map could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { counts, rows, trail, rules } = screen;
  const count = (n: number) => formatCount(n, ctx.company.currency);
  const updated = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ctx.company.timezone,
  }).format(new Date(screen.generatedAt));

  return (
    <section aria-labelledby="map-heading" className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="map-heading" className="font-serif text-2xl text-primary">
            Staff map
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {formatLongDay(screen.date)}: who checked in, where, and where their phone was last. Red
            means no position for {rules.signalLostMinutes} minutes: the phone is off, out of signal
            or its location is switched off.
          </p>
        </div>
        <p className="text-[0.8125rem] text-muted-foreground" aria-live="polite">
          Updated {updated}, refreshes every {rules.refreshSeconds} seconds
        </p>
      </div>

      {!screen.gpsAttendance && (
        <FormAlert tone="note">
          Location is not asked for at check-in, so only check-ins appear here.{" "}
          <Link href={hrHref.settings()} className="font-medium underline underline-offset-4">
            Turn it on in Holidays &amp; rules
          </Link>
        </FormAlert>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On duty" value={count(counts.onDuty)} />
        <Stat label="No signal" value={count(counts.noSignal)} alert={counts.noSignal > 0} />
        <Stat label="Away at check-in" value={count(counts.away)} alert={counts.away > 0} />
        <Stat label="Checked out" value={count(counts.checkedOut)} />
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <StaffMap screen={screen} person={trail ? person : null} />
          {trail && (
            <Panel
              title={`${trail.name}'s route`}
              id="route-heading"
              action={
                <Link href={hrHref.map()} scroll={false} className={`text-sm ${linkClass}`}>
                  Show everyone
                </Link>
              }
            >
              {trail.points.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No positions from this shift yet.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 text-sm">
                  <p>
                    {trail.points.length === 1
                      ? "1 position"
                      : `${count(trail.points.length)} positions`}{" "}
                    from {trail.points[0]!.time} to {trail.points.at(-1)!.time}, about{" "}
                    {distanceText(trail.metres)} travelled.
                    {trail.cut && " Only the first part of a very long day is shown."}
                  </p>
                  {trail.route && (
                    <p>
                      <a href={trail.route} target="_blank" rel="noreferrer" className={linkClass}>
                        Open the route in Google Maps
                      </a>
                    </p>
                  )}
                </div>
              )}
            </Panel>
          )}
        </div>

        <Panel title="Checked in today" id="people-heading">
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nobody has checked in themselves today.
            </p>
          ) : (
            <ul className="mt-3 grid divide-y" aria-label="Staff checked in today">
              {rows.map((r) => (
                <li key={r.employeeId} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        <Link href={hrHref.employee(r.employeeId)} className="hover:underline">
                          {r.name}
                        </Link>
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {[r.code, r.designation, r.workPlace].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <StateBadge row={r} />
                  </div>
                  <p className="text-[0.8125rem]">
                    {checkInText(r)}
                    {r.checkIn.away && (
                      <>
                        {" "}
                        <FlagBadge tone="warn">Location mismatch</FlagBadge>
                      </>
                    )}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {r.last ? (
                      <>
                        Last seen {r.last.time}
                        {r.last.battery !== null && `, battery ${r.last.battery}%`}
                        {r.last.source === "ANDROID" ? ", app" : ", browser"} ·{" "}
                        <a
                          href={r.last.link}
                          target="_blank"
                          rel="noreferrer"
                          className={linkClass}
                        >
                          Open in Google Maps
                        </a>
                      </>
                    ) : (
                      "No position since check-in"
                    )}
                  </p>
                  <p className="text-[0.8125rem]">
                    {trail?.employeeId === r.employeeId ? (
                      <span className="text-muted-foreground">Route shown on the map</span>
                    ) : (
                      <Link href={hrHref.map(r.employeeId)} scroll={false} className={linkClass}>
                        Show the route
                      </Link>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
