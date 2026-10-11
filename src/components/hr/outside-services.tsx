import type { PlugStatus } from "@/modules/integrations/config";

import { FlagBadge } from "./badges";

const PLUGS: Record<PlugStatus["key"], { name: string; does: string; meanwhile: string }> = {
  sms: {
    name: "SMS codes",
    does: "Sends a one-time code by SMS, for example when staff agree to the terms.",
    meanwhile: "Until it is on, staff sign with a drawn signature.",
  },
  push: {
    name: "Phone notifications",
    does: "Tells staff about new tasks and notices on their phone.",
    meanwhile: "Until it is on, the in-app inbox carries every message.",
  },
  payouts: {
    name: "bKash and Nagad payouts",
    does: "Sends salaries and reimbursements straight to staff wallets.",
    meanwhile: "Until it is on, Accounts pays and records salaries as today.",
  },
  maps: {
    name: "Google Maps",
    does: "Measures road distances for travel claims.",
    meanwhile:
      "Not needed for the staff map, which uses OpenStreetMap; every position also opens in Google Maps without it.",
  },
};

const STATE_WORDS = { OFF: "Off", TEST: "Test mode", ON: "Connected" } as const;

/**
 * Where each outside service stands (HR, read only): they are switched on on
 * the server (deploy/README.md, "Outside services"), never from this screen.
 */
export function OutsideServices({ plugs }: { plugs: readonly PlugStatus[] }) {
  return (
    <ul className="mt-4 grid divide-y" aria-label="Outside services">
      {plugs.map((plug) => {
        const words = PLUGS[plug.key];
        return (
          <li key={plug.key} className="grid gap-1.5 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{words.name}</span>
              <FlagBadge
                tone={plug.state === "ON" ? "done" : plug.state === "TEST" ? "open" : "plain"}
              >
                {STATE_WORDS[plug.state]}
              </FlagBadge>
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              {words.does}{" "}
              {plug.state === "TEST"
                ? "In test mode nothing is sent: the server log shows each message."
                : plug.state === "OFF"
                  ? words.meanwhile
                  : ""}
            </p>
            {plug.problem && (
              <p className="text-[0.8125rem] text-destructive">Setting to fix: {plug.problem}</p>
            )}
            <p className="text-[0.75rem] break-words text-muted-foreground">
              Server settings: <span className="font-mono">{plug.settings.join(", ")}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
