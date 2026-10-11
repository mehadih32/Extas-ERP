"use client";

import { LocateFixedIcon, LoaderCircleIcon, MapPinIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_RADIUS_METRES, distanceText, isLatLng, RADIUS_LIMITS } from "@/modules/hr/geo";
import type { PresentedPlace } from "@/modules/hr/location.service";
import {
  createWorkPlaceAction,
  removeWorkPlaceAction,
  updateWorkPlaceAction,
} from "@/server/actions/hr.actions";

import { currentPosition, noPositionText } from "./location-client";
import { useNotice } from "./use-notice";

const smallText = "block text-[0.8125rem] text-muted-foreground";
const linkClass = "text-primary underline-offset-4 hover:underline";

type Editing = { mode: "new" } | { mode: "edit"; place: PresentedPlace };

/** "23.780600, 90.407000" (a point copied from Google Maps) as two numbers. */
function pointIn(text: string) {
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  return match ? { lat: match[1]!, lng: match[2]! } : null;
}

const staffText = (n: number) =>
  n === 0 ? "Nobody assigned" : n === 1 ? "1 person assigned" : `${n} people assigned`;

/**
 * The offices, factories and shops staff check in at (GPS attendance), each
 * with its radius: checking in further away than that shows as a location
 * mismatch. HR (hr.manage) adds, changes and removes them; standing at the
 * place, "Use my location" fills in its position.
 */
export function WorkPlaces({
  places,
  canManage,
}: {
  places: PresentedPlace[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<PresentedPlace | null>(null);
  const [notice, setNotice] = useNotice();
  const current = editing?.mode === "edit" ? editing.place : null;

  return (
    <div className="grid gap-4">
      {places.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No work places yet. Without one, check-ins still record where the phone was, but nothing
          is compared.
        </p>
      ) : (
        <ul className="grid divide-y" aria-label="Work places">
          {places.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium break-words">
                  <MapPinIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {p.name}
                </span>
                {p.address && <span className={`${smallText} break-words`}>{p.address}</span>}
                <span className={smallText}>
                  Within {distanceText(p.radiusMeters)} · {staffText(p.staff)} ·{" "}
                  <a href={p.link} target="_blank" rel="noreferrer" className={linkClass}>
                    Open in Google Maps
                  </a>
                </span>
              </span>
              {canManage && (
                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ mode: "edit", place: p })}
                    aria-label={`Change ${p.name}`}
                  >
                    Change
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(p)}
                    aria-label={`Remove ${p.name}`}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setEditing({ mode: "new" })}
          >
            <PlusIcon aria-hidden />
            Add a work place
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {editing && (
        <FormDialog
          title={current ? `Change ${current.name}` : "Add a work place"}
          description="Stand at the place and use your phone's location, or paste the point from Google Maps. Checking in further away than the radius shows as a location mismatch."
          submitLabel={current ? "Save" : "Add the work place"}
          pendingLabel="Saving"
          errorTitle="We could not save the work place"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            const address = textOf(form, "address");
            const lat = Number(textOf(form, "lat"));
            const lng = Number(textOf(form, "lng"));
            const radiusText = textOf(form, "radiusMeters");
            const radiusMeters = /^\d{1,4}$/.test(radiusText) ? Number(radiusText) : Number.NaN;
            const errors: Record<string, string> = {};
            if (name.length < 2) errors.name = "Name the place.";
            if (!textOf(form, "lat") || !textOf(form, "lng") || !isLatLng({ lat, lng })) {
              errors.lat = "Use your location, or paste the point from Google Maps.";
            }
            if (!(radiusMeters >= RADIUS_LIMITS.min && radiusMeters <= RADIUS_LIMITS.max)) {
              errors.radiusMeters = `Write the metres, from ${RADIUS_LIMITS.min} to ${RADIUS_LIMITS.max}.`;
            }
            if (Object.keys(errors).length > 0) return problem(errors);
            const input = { name, address: address || null, lat, lng, radiusMeters };
            const result = current
              ? await updateWorkPlaceAction(current.id, input)
              : await createWorkPlaceAction(input);
            if (!result.ok) return result.error;
            setNotice(current ? `${result.data.name} is saved.` : `${result.data.name} is added.`);
            setEditing(null);
          }}
        >
          {(fieldError) => <PlaceFields place={current} fieldError={fieldError} />}
        </FormDialog>
      )}

      {removing && (
        <FormDialog
          title={`Remove ${removing.name}?`}
          description={
            removing.staff > 0
              ? `${staffText(removing.staff)} here. Their check-ins are compared with the nearest work place instead. Past check-ins keep the place's name.`
              : "Past check-ins keep the place's name."
          }
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the work place"
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            const result = await removeWorkPlaceAction(removing.id);
            if (!result.ok) return result.error;
            setNotice(`${removing.name} is removed.`);
            setRemoving(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

function PlaceFields({
  place,
  fieldError,
}: {
  place: PresentedPlace | null;
  fieldError: (name: string) => string | undefined;
}) {
  const [lat, setLat] = useState(place ? String(place.lat) : "");
  const [lng, setLng] = useState(place ? String(place.lng) : "");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<string>();
  const [trouble, setTrouble] = useState<string>();

  async function useMyLocation() {
    setTrouble(undefined);
    setFound(undefined);
    setFinding(true);
    const result = await currentPosition();
    setFinding(false);
    if (!result.ok) return setTrouble(noPositionText(result.reason));
    setLat(result.position.lat.toFixed(6));
    setLng(result.position.lng.toFixed(6));
    setFound(
      result.position.accuracy
        ? `Found, to within ${distanceText(result.position.accuracy)}.`
        : "Found.",
    );
  }

  /** Pasting "23.7806, 90.4070" into either box fills both. */
  function typed(which: "lat" | "lng", value: string) {
    const point = pointIn(value);
    if (point) {
      setLat(point.lat);
      setLng(point.lng);
    } else if (which === "lat") setLat(value);
    else setLng(value);
  }

  return (
    <>
      <Field id="place-name" label="Name" error={fieldError("name")}>
        <Input
          id="place-name"
          name="name"
          maxLength={80}
          required
          placeholder="Head office"
          defaultValue={place?.name}
          aria-invalid={Boolean(fieldError("name"))}
        />
      </Field>
      <Field id="place-address" label="Address (optional)" error={fieldError("address")}>
        <Input
          id="place-address"
          name="address"
          maxLength={200}
          defaultValue={place?.address ?? ""}
          aria-invalid={Boolean(fieldError("address"))}
        />
      </Field>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Where it is</legend>
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={finding}
            onClick={useMyLocation}
          >
            {finding ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <LocateFixedIcon aria-hidden />
            )}
            {finding ? "Finding your location" : "Use my location"}
          </Button>
        </div>
        {found && <p className="text-[0.8125rem] text-muted-foreground">{found}</p>}
        {trouble && <p className="text-[0.8125rem] text-destructive">{trouble}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="place-lat" label="Latitude" error={fieldError("lat")}>
            <Input
              id="place-lat"
              name="lat"
              inputMode="decimal"
              autoComplete="off"
              placeholder="23.780600"
              value={lat}
              onChange={(e) => typed("lat", e.target.value)}
              aria-invalid={Boolean(fieldError("lat"))}
            />
          </Field>
          <Field id="place-lng" label="Longitude" error={fieldError("lng")}>
            <Input
              id="place-lng"
              name="lng"
              inputMode="decimal"
              autoComplete="off"
              placeholder="90.407000"
              value={lng}
              onChange={(e) => typed("lng", e.target.value)}
              aria-invalid={Boolean(fieldError("lng"))}
            />
          </Field>
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          In Google Maps, press and hold the place, then copy the numbers at the top and paste them
          here.
        </p>
      </fieldset>
      <Field
        id="place-radius"
        label="Radius in metres"
        hint="How far from this point still counts as being here. 150 suits most buildings."
        error={fieldError("radiusMeters")}
      >
        <Input
          id="place-radius"
          name="radiusMeters"
          inputMode="numeric"
          required
          defaultValue={place?.radiusMeters ?? DEFAULT_RADIUS_METRES}
          aria-invalid={Boolean(fieldError("radiusMeters"))}
        />
      </Field>
    </>
  );
}
