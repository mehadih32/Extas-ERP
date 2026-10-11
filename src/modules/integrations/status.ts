import type { PlugStatus, Settings } from "./config";
import { serverSettings } from "./config";
import { mapsStatus } from "./maps";
import { payoutStatus } from "./payouts";
import { pushStatus } from "./push";
import { smsStatus } from "./sms";

/** Where each outside service stands, for the "Outside services" panel. */
export function integrationStatus(settings: Settings = serverSettings()): PlugStatus[] {
  return [smsStatus(settings), pushStatus(settings), payoutStatus(settings), mapsStatus(settings)];
}
