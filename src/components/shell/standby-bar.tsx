/**
 * The bar across the top of every page while this ERP waits on standby after a
 * restore (src/modules/backups/standby.ts), so nobody uses it without knowing the
 * web address does not point here yet.
 */
export function StandbyBar() {
  return (
    <div
      role="alert"
      className="bg-red-600 px-4 py-2 text-center text-sm font-semibold break-words text-white print:hidden"
    >
      This ERP is on standby: the web address does not point here yet. Backups and alarms run;
      reminders and messages wait until sudo ./deploy/go-live.sh is run on this server.
    </div>
  );
}

/**
 * The bar across the top of every page of a restore drill copy (test mode, the
 * restore guide's "Practice: a restore drill"), so nobody takes it for the real ERP.
 */
export function DrillBar() {
  return (
    <div
      role="alert"
      className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold break-words text-black print:hidden"
    >
      This is a restore drill copy (test mode), not your real ERP. It sends no emails or bot
      messages. Delete this server when the drill is done.
    </div>
  );
}
