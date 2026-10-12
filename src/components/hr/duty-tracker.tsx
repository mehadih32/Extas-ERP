"use client";

import { LoaderCircleIcon, LogOutIcon, MapPinOffIcon, RotateCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { PING_EVERY_SECONDS, SEND_EVERY_SECONDS } from "@/modules/hr/geo";
import type { DutyState } from "@/modules/hr/location.service";
import { checkOutAction } from "@/server/actions/portal.actions";

import {
  currentPosition,
  DUTY_CHANGED,
  dutyChanged,
  inAndroidApp,
  noPositionText,
  tracker,
  type NoPosition,
  type TrackerStatus,
} from "./location-client";

const DUTY_PATH = "/api/portal/location/duty";
/** How often the frame asks whether the person is still checked in. */
const RECHECK_MS = 5 * 60_000;

type Point = {
  at: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  battery: number | null;
};

type BatteryManager = { level: number };

async function batteryLevel(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    const b = await nav.getBattery?.();
    return b ? Math.round(b.level * 100) : null;
  } catch {
    return null;
  }
}

/** Whether to send positions now; null when it does not apply, undefined when nobody answered. */
async function fetchDuty(): Promise<DutyState | null | undefined> {
  try {
    const response = await fetch(DUTY_PATH, { cache: "no-store", credentials: "same-origin" });
    if (response.status >= 500) return undefined;
    if (!response.ok) return null;
    const body = (await response.json()) as { ok: boolean; data: DutyState | null };
    return body.ok ? body.data : null;
  } catch {
    // Offline: carry on as before.
    return undefined;
  }
}

/**
 * Keeps sending the phone's position while the person is checked in (GPS
 * attendance), and locks the app while location is off or refused, with
 * "Check out now" so nobody is stuck. In the browser it takes a position every
 * 30 seconds and sends them each minute while the app is open; in the Android
 * app a background service does it, with the screen off or the app closed,
 * until check-out. Mounted once in the app frame for people with My HR.
 */
export function DutyTracker() {
  const router = useRouter();
  /** Undefined until the server first answers. */
  const [duty, setDuty] = useState<DutyState | null>();
  const [lock, setLock] = useState<NoPosition | null>(null);
  const [trying, setTrying] = useState(false);
  /** Starts the browser's watch again after location is allowed or switched back on. */
  const [attempt, setAttempt] = useState(0);
  const [leaving, startLeaving] = useTransition();
  const [error, setError] = useState<string>();
  const lastCheck = useRef(0);
  const buffer = useRef<Point[]>([]);
  const latest = useRef<Point | null>(null);

  // Asks on opening, after checking in or out, on coming back to the app, and every few minutes.
  useEffect(() => {
    let live = true;
    const load = (force: boolean) => {
      if (!force && Date.now() - lastCheck.current < 5_000) return;
      lastCheck.current = Date.now();
      void fetchDuty().then((next) => {
        if (!live || next === undefined) return;
        setDuty(next);
        if (!next?.onDuty) setLock(null);
      });
    };
    load(true);
    const changed = () => load(true);
    const visible = () => document.visibilityState === "visible" && load(false);
    const timer = window.setInterval(visible, RECHECK_MS);
    window.addEventListener(DUTY_CHANGED, changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(DUTY_CHANGED, changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const onDuty = duty?.onDuty ?? false;
  const endpoint = duty?.endpoint;

  // In the Android app: the background service does the sending.
  useEffect(() => {
    if (!inAndroidApp() || duty === undefined) return;
    if (!duty?.onDuty) {
      void tracker("stop");
      return;
    }
    let cancelled = false;
    const status = async () => {
      const s = await tracker<TrackerStatus>("status");
      if (cancelled || !s) return;
      setLock(s.permission !== "granted" ? "denied" : !s.locationOn ? "unavailable" : null);
    };
    (async () => {
      await tracker("start", {
        endpoint: new URL(duty.endpoint, window.location.origin).href,
        pingEverySeconds: duty.pingEverySeconds,
        sendEverySeconds: duty.sendEverySeconds,
      });
      await status();
    })();
    const timer = window.setInterval(status, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [duty]);

  // In the browser: watch the position while the app is open and send it each minute.
  useEffect(() => {
    if (inAndroidApp() || !onDuty || !endpoint || !navigator.geolocation) {
      buffer.current = [];
      latest.current = null;
      return;
    }
    let stopped = false;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setLock(null);
        latest.current = {
          at: p.timestamp || Date.now(),
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
          speed: p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed : null,
          battery: null,
        };
      },
      (e) => setLock(e.code === 1 ? "denied" : e.code === 3 ? null : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 },
    );
    const sample = async () => {
      const point = latest.current;
      if (!point) return;
      const previous = buffer.current.at(-1);
      // A still phone repeats its last fix: send it again with the time it was taken.
      if (previous && previous.at === point.at) return;
      buffer.current.push({ ...point, battery: await batteryLevel() });
      if (buffer.current.length > 300) buffer.current.splice(0, buffer.current.length - 300);
    };
    const send = async (leaving = false) => {
      await sample();
      if (buffer.current.length === 0) return;
      const points = buffer.current;
      buffer.current = [];
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "WEB", points }),
          credentials: "same-origin",
          keepalive: leaving,
        });
        if (leaving) return;
        const body = (await response.json()) as { ok: boolean; data?: { onDuty: boolean } };
        if (body.ok && body.data && !body.data.onDuty && !stopped) dutyChanged();
        if (!body.ok && response.status >= 500) buffer.current.unshift(...points);
      } catch {
        // Offline: keep them for the next try.
        if (!leaving) buffer.current.unshift(...points);
      }
    };
    const sampler = window.setInterval(sample, PING_EVERY_SECONDS * 1000);
    const sender = window.setInterval(() => void send(), SEND_EVERY_SECONDS * 1000);
    const hidden = () => document.visibilityState === "hidden" && void send(true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(sampler);
      window.clearInterval(sender);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [onDuty, endpoint, attempt]);

  async function tryAgain() {
    setError(undefined);
    setTrying(true);
    if (inAndroidApp()) await tracker("permissions");
    const found = await currentPosition();
    setTrying(false);
    if (found.ok) {
      setLock(null);
      setAttempt((n) => n + 1);
      if (inAndroidApp()) {
        const s = await tracker<TrackerStatus>("status");
        if (s && !s.running) dutyChanged();
      }
    } else setLock(found.reason);
  }

  function checkOutNow() {
    setError(undefined);
    startLeaving(async () => {
      const result = await checkOutAction({});
      if (!result.ok) return setError(result.error.message);
      setLock(null);
      dutyChanged();
      router.refresh();
    });
  }

  // Nothing to share a location with (an old browser): HR asks for it, so the app is locked.
  const blocked =
    lock ?? (onDuty && !inAndroidApp() && !navigator.geolocation ? "unsupported" : null);
  if (!onDuty || !blocked) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="gps-lock-heading"
      aria-describedby="gps-lock-text"
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm"
    >
      <div className="grid w-full max-w-md gap-5 rounded-lg border bg-card p-6 shadow-lg">
        <MapPinOffIcon className="size-10 text-destructive" aria-hidden />
        <div className="grid gap-2">
          <h2 id="gps-lock-heading" className="font-serif text-2xl text-primary">
            Turn on your location
          </h2>
          <p id="gps-lock-text" className="text-sm leading-relaxed text-muted-foreground">
            You are checked in, so Extas ERP shares your location until you check out.{" "}
            {noPositionText(blocked)}
          </p>
        </div>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={tryAgain} disabled={trying || leaving}>
            {trying ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <RotateCwIcon aria-hidden />
            )}
            {trying ? "Finding your location" : "Try again"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={checkOutNow}
            disabled={trying || leaving}
          >
            {leaving ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <LogOutIcon aria-hidden />
            )}
            {leaving ? "Checking out" : "Check out now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
