/*
 * The phone's position for GPS attendance, in the browser and in the Extas
 * ERP Android app. The app (mobile/ in the repo) loads these same pages and
 * adds a "DutyTracker" plugin that keeps sending positions from a foreground
 * service while the person is checked in, with the screen off or the app
 * closed. Pages reach it through the bridge the app injects
 * (window.Capacitor), so the web build needs no Capacitor package.
 */

export type Position = { lat: number; lng: number; accuracy: number | null };
export type PositionSource = "WEB" | "ANDROID";

/** Why there is no position: location refused, switched off, too slow, or no GPS at all. */
export type NoPosition = "denied" | "unavailable" | "timeout" | "unsupported";

export type PositionResult =
  { ok: true; position: Position; source: PositionSource } | { ok: false; reason: NoPosition };

type Bridge = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
};

const PLUGIN = "DutyTracker";

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/** Running inside the Android app, with its background tracker. */
export function inAndroidApp(): boolean {
  const cap = bridge();
  return Boolean(cap?.isPluginAvailable?.(PLUGIN) && cap.nativePromise);
}

/** Calls the Android app's tracker; null outside the app or when the call fails. */
export async function tracker<T = unknown>(
  method: string,
  options: object = {},
): Promise<T | null> {
  const cap = bridge();
  if (!cap?.nativePromise || !cap.isPluginAvailable?.(PLUGIN)) return null;
  try {
    return (await cap.nativePromise(PLUGIN, method, options)) as T;
  } catch {
    return null;
  }
}

/** What the Android app reports about its tracker. */
export type TrackerStatus = {
  running: boolean;
  /** Location switched on in the phone's settings. */
  locationOn: boolean;
  /** "granted", "denied" or "prompt". */
  permission: string;
  /** Positions taken but not sent yet (no network). */
  waiting: number;
};

const REASONS: Record<number, NoPosition> = { 1: "denied", 2: "unavailable", 3: "timeout" };

/**
 * One fresh position (up to 20 seconds; a reading up to a minute old is fine).
 * In the Android app the phone asks for location permission the first time.
 */
export function currentPosition(timeout = 20_000): Promise<PositionResult> {
  const source: PositionSource = inAndroidApp() ? "ANDROID" : "WEB";
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          ok: true,
          source,
          position: {
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
          },
        }),
      (error) => resolve({ ok: false, reason: REASONS[error.code] ?? "unavailable" }),
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    );
  });
}

/** What to tell the person when there is no position. */
export function noPositionText(reason: NoPosition): string {
  switch (reason) {
    case "denied":
      return inAndroidApp()
        ? "Extas ERP is not allowed to use your location. Allow it in the phone's settings (Apps, Extas ERP, Permissions, Location), then try again."
        : "This browser is not allowed to use your location. Allow location for this site in the browser's settings, then try again.";
    case "timeout":
      return "Your phone could not find its location in time. Step outside or near a window and try again.";
    case "unsupported":
      return "This browser cannot share a location. Use the Extas ERP app or Chrome on your phone.";
    default:
      return "Your phone's location is switched off. Turn on location, then try again.";
  }
}

/** Tells the frame that the person checked in or out, so tracking starts or stops at once. */
export const DUTY_CHANGED = "extas:duty-changed";

export function dutyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DUTY_CHANGED));
}
