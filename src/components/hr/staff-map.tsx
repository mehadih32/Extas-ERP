"use client";

import "leaflet/dist/leaflet.css";

import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { StaffMapScreen } from "@/modules/hr/location.service";

import { hrHref } from "./labels";

type Row = StaffMapScreen["rows"][number];

/** Map colours: on duty, no signal, checked out, the trail and work places. */
const COLOURS = {
  ON_DUTY: "#15803d",
  NO_SIGNAL: "#dc2626",
  CHECKED_OUT: "#6b7280",
  trail: "#2563eb",
  place: "#7c3aed",
} as const;

/** Where to put a person: their last position, else where they checked in. */
function pointOf(r: Row) {
  if (r.last) return { lat: r.last.lat, lng: r.last.lng, time: r.last.time };
  if (r.checkIn.located && r.checkIn.lat !== null && r.checkIn.lng !== null) {
    return { lat: r.checkIn.lat, lng: r.checkIn.lng, time: r.checkIn.time };
  }
  return null;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The live map (OpenStreetMap, no key needed): a dot for each person checked
 * in today at their last position (green on duty, red no signal, grey checked
 * out), the work places with their radius, and the chosen person's trail.
 * Tapping a dot shows that person's trail. The screen refreshes itself every
 * `refreshSeconds` while it is in view.
 */
export function StaffMap({ screen, person }: { screen: StaffMapScreen; person: string | null }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef<string | null>(null);

  // Draws the map once, then redraws the dots whenever the data changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current) return;
      if (!map.current) {
        map.current = L.map(box.current, { zoomControl: true, attributionControl: true });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      const group = layer.current!;
      group.clearLayers();
      const bounds: Array<[number, number]> = [];

      for (const p of screen.places) {
        L.circle([p.lat, p.lng], {
          radius: p.radiusMeters,
          color: COLOURS.place,
          weight: 1.5,
          fillOpacity: 0.08,
        })
          .bindTooltip(escape(p.name))
          .addTo(group);
        bounds.push([p.lat, p.lng]);
      }

      const trail = screen.trail;
      if (trail && trail.points.length > 0) {
        const line = trail.points.map((t) => [t.lat, t.lng] as [number, number]);
        L.polyline(line, { color: COLOURS.trail, weight: 4, opacity: 0.8 }).addTo(group);
        const first = trail.points[0]!;
        L.circleMarker([first.lat, first.lng], {
          radius: 6,
          color: COLOURS.trail,
          fillColor: "#ffffff",
          fillOpacity: 1,
          weight: 3,
        })
          .bindTooltip(`Start ${escape(first.time)}`)
          .addTo(group);
      }

      const dots: CircleMarker[] = [];
      for (const r of screen.rows) {
        const at = pointOf(r);
        if (!at) continue;
        const chosen = r.employeeId === person;
        const dot = L.circleMarker([at.lat, at.lng], {
          radius: chosen ? 10 : 8,
          color: "#ffffff",
          weight: 2,
          fillColor: COLOURS[r.state],
          fillOpacity: 1,
        })
          .bindTooltip(`${escape(r.name)} · ${escape(at.time)}`, { direction: "top" })
          .on("click", () => router.push(hrHref.map(r.employeeId), { scroll: false }));
        dot.addTo(group);
        dots.push(dot);
        if (!trail || chosen) bounds.push([at.lat, at.lng]);
      }

      // Fit the view when the page opens or another person is chosen, not on every refresh.
      const view = person ?? "";
      if (fitted.current !== view) {
        const focus =
          trail && trail.points.length > 0
            ? trail.points.map((t) => [t.lat, t.lng] as [number, number])
            : bounds;
        if (focus.length > 0) {
          map.current.fitBounds(L.latLngBounds(focus).pad(0.2), { maxZoom: 16 });
          fitted.current = view;
        } else if (fitted.current === null) {
          // Nothing to show yet: Bangladesh.
          map.current.setView([23.7, 90.4], 7);
        }
      }
      for (const dot of dots) dot.bringToFront();
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, person, router]);

  // Removes the map when the page closes.
  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      layer.current = null;
    },
    [],
  );

  // Keeps the screen live while it is in view, without stacking refreshes.
  useEffect(() => {
    let last = Date.now();
    const every = screen.rules.refreshSeconds * 1000;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < every / 2) return;
      last = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(refresh, every);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, screen.rules.refreshSeconds]);

  return (
    <div
      ref={box}
      role="region"
      aria-label="Map of staff positions"
      className="relative z-0 h-[22rem] w-full overflow-hidden rounded-lg border bg-muted sm:h-[28rem]"
    />
  );
}
