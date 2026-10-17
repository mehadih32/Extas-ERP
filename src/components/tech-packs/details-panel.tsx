"use client";

import { Link2Icon, PencilIcon, Unlink2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import {
  linkTechPackToProjectAction,
  linkTechPackToStyleAction,
  updateTechPackDetailsAction,
} from "@/server/actions/tech-pack.actions";

import { BuyerPicker, type Choice, ProjectPicker, StylePicker } from "./pickers";

/*
 * A tech pack's own details (number, title, buyer, style, season, the
 * buyer's brief) and its links: the style in production it belongs to once
 * the order comes, and a catalogue style. Links change only while it is not
 * approved and its fabric part is not locked. Once approved, its title, buyer
 * and brief stay as approved too; only its season still changes.
 */

type Asking = "details" | "project" | "unproject" | "style" | "unstyle" | null;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

export function TechPackDetailsPanel({ screen }: { screen: TechPackScreen }) {
  const { techPack: t, can, approval } = screen;
  const approved = approval.status === "APPROVED";
  const [asking, setAsking] = useState<Asking>(null);
  const [notice, setNotice] = useState<string>();
  const [buyer, setBuyer] = useState<Choice | null>(null);
  const [project, setProject] = useState<Choice | null>(null);
  const [style, setStyle] = useState<Choice | null>(null);
  const close = () => setAsking(null);
  const done = (message: string) => {
    setNotice(message);
    setAsking(null);
  };

  return (
    <Panel
      title="Details and links"
      id="tech-pack-details-heading"
      action={
        can.edit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setBuyer(t.buyer ? { id: t.buyer.id, label: t.buyer.name } : null);
              setAsking("details");
            }}
          >
            <PencilIcon aria-hidden />
            {approved ? "Edit the season" : "Edit details"}
          </Button>
        ) : undefined
      }
    >
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Number">{t.number}</Fact>
        <Fact label="Buyer">{t.buyer?.name ?? t.project?.buyer ?? "Not given yet"}</Fact>
        <Fact label="Season">{t.season ?? "Not given"}</Fact>
        <Fact label="Style">{t.style ? `${t.style.code} · ${t.style.name}` : "Not linked"}</Fact>
        <Fact label="Production project">
          {t.project ? (
            <Link
              href={productionHref.project(t.project.id)}
              className="text-primary underline-offset-4 hover:underline"
            >
              {t.project.code} · {t.project.name}
            </Link>
          ) : (
            "Not linked yet"
          )}
        </Fact>
        <Fact label="Started">
          {formatDay(t.createdOn)}
          {t.createdBy ? ` by ${t.createdBy}` : ""}
        </Fact>
      </dl>
      {t.brief && (
        <div className="mt-5">
          <p className="eyebrow">Buyer&apos;s brief</p>
          <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line">{t.brief}</p>
        </div>
      )}
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {can.link ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {t.project ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAsking("unproject")}
            >
              <Unlink2Icon aria-hidden />
              Take it off the project
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setProject(null);
                setAsking("project");
              }}
            >
              <Link2Icon aria-hidden />
              Link to a production project
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setStyle(null);
              setAsking("style");
            }}
          >
            <Link2Icon aria-hidden />
            {t.style ? "Change the style" : "Link to a style"}
          </Button>
          {t.style && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking("unstyle")}>
              <Unlink2Icon aria-hidden />
              Take it off the style
            </Button>
          )}
        </div>
      ) : (
        (approved || approval.fabricLocked) && (
          <p className="mt-4 text-[0.8125rem] text-muted-foreground">
            {approved
              ? "Approved: its title, buyer, brief and links no longer change."
              : "Its fabric part is locked: its links no longer change."}
          </p>
        )
      )}

      {asking === "details" && (
        <FormDialog
          title={`Edit ${t.number}`}
          description={
            approved
              ? "Approved: the title, buyer and brief no longer change. The season still can."
              : "The title, buyer, season and the buyer's brief."
          }
          submitLabel="Save details"
          pendingLabel="Saving"
          errorTitle="We could not save the details"
          className="sm:max-w-2xl"
          onClose={close}
          onSubmit={async (form) => {
            const result = await updateTechPackDetailsAction(
              t.id,
              approved
                ? { title: t.title, season: form.get("season") }
                : {
                    title: form.get("title"),
                    buyerId: buyer?.id ?? "",
                    season: form.get("season"),
                    brief: form.get("brief"),
                  },
            );
            if (!result.ok) return result.error;
            done("The details are saved.");
          }}
        >
          {(fieldError) => (
            <>
              {!approved && (
                <>
                  <Field id="tpd-title" label="Title" error={fieldError("title")}>
                    <Input id="tpd-title" name="title" defaultValue={t.title} maxLength={160} />
                  </Field>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Buyer</span>
                    <BuyerPicker id="tpd-buyer" value={buyer} onChange={setBuyer} />
                    {fieldError("buyerId") && (
                      <p className="text-[0.8125rem] text-destructive">{fieldError("buyerId")}</p>
                    )}
                  </div>
                </>
              )}
              <Field id="tpd-season" label="Season" error={fieldError("season")}>
                <Input id="tpd-season" name="season" defaultValue={t.season ?? ""} maxLength={40} />
              </Field>
              {!approved && (
                <Field id="tpd-brief" label="Buyer's brief" error={fieldError("brief")}>
                  <Textarea
                    id="tpd-brief"
                    name="brief"
                    rows={6}
                    defaultValue={t.brief ?? ""}
                    maxLength={5000}
                  />
                </Field>
              )}
            </>
          )}
        </FormDialog>
      )}

      {asking === "project" && (
        <FormDialog
          title={`Link ${t.number} to a production project`}
          description="When the order comes: the project's style and buyer fill this tech pack's if it has none, and the project's bookings follow this tech pack's approval. Only projects without a tech pack of their own are listed."
          submitLabel="Link"
          pendingLabel="Linking"
          errorTitle="We could not link the tech pack"
          onClose={close}
          onSubmit={async () => {
            if (!project) return { code: "VALIDATION", message: "Pick the production project." };
            const result = await linkTechPackToProjectAction(t.id, { projectId: project.id });
            if (!result.ok) return result.error;
            done(`Linked to ${project.label}.`);
          }}
        >
          {() => <ProjectPicker id="tpl-project" value={project} onChange={setProject} />}
        </FormDialog>
      )}

      {asking === "unproject" && t.project && (
        <FormDialog
          title={`Take ${t.number} off ${t.project.code}?`}
          description="The project then has no tech pack, and its trims wait again for an approved tech pack. Nothing on the tech pack is lost."
          submitLabel="Take it off"
          pendingLabel="Taking it off"
          errorTitle="We could not take the tech pack off"
          onClose={close}
          onSubmit={async () => {
            const result = await linkTechPackToProjectAction(t.id, { projectId: null });
            if (!result.ok) return result.error;
            done("Taken off the project.");
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {asking === "style" && (
        <FormDialog
          title={`Link ${t.number} to a style`}
          description="The catalogue style this tech pack is for."
          submitLabel="Link"
          pendingLabel="Linking"
          errorTitle="We could not link the style"
          onClose={close}
          onSubmit={async () => {
            if (!style) return { code: "VALIDATION", message: "Pick the style." };
            const result = await linkTechPackToStyleAction(t.id, { styleId: style.id });
            if (!result.ok) return result.error;
            done(`Linked to the style ${style.label}.`);
          }}
        >
          {() => <StylePicker id="tpl-style" value={style} onChange={setStyle} />}
        </FormDialog>
      )}

      {asking === "unstyle" && t.style && (
        <FormDialog
          title={`Take ${t.number} off the style ${t.style.code}?`}
          description="Nothing on the tech pack is lost."
          submitLabel="Take it off"
          pendingLabel="Taking it off"
          errorTitle="We could not take the style off"
          onClose={close}
          onSubmit={async () => {
            const result = await linkTechPackToStyleAction(t.id, { styleId: null });
            if (!result.ok) return result.error;
            done("Taken off the style.");
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </Panel>
  );
}
