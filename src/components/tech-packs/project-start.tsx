"use client";

import { ClipboardPlusIcon, Link2Icon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import {
  linkTechPackToProjectAction,
  startProjectTechPackAction,
} from "@/server/actions/tech-pack.actions";

import { type Choice, TechPackPicker } from "./pickers";

/*
 * A style in production without a tech pack yet: start its own, or link one
 * started from the buyer's brief before the order came.
 */

export function ProjectTechPackStart({
  project,
  can,
}: {
  project: { id: string; code: string; name: string };
  can: { start: boolean; link: boolean };
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  const open = (techPackId: string) => router.push(productionHref.techPackOf(techPackId));

  if (!can.start && !can.link) {
    return (
      <Panel title="No tech pack yet" id="tech-pack-start-heading">
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {project.code} has no tech pack yet. Someone who manages production can start one here, or
          link one made from the buyer&apos;s brief.
        </p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {can.start && (
        <Panel title="Start its tech pack" id="tech-pack-start-heading">
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A new tech pack for {project.code} · {project.name}, with the project&apos;s buyer and
            style.
          </p>
          <div className="mt-4">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await startProjectTechPackAction(project.id);
                  if (!result.ok) return setError(result.error);
                  open(result.data.id);
                })
              }
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden />
              ) : (
                <ClipboardPlusIcon aria-hidden />
              )}
              Start the tech pack
            </Button>
          </div>
        </Panel>
      )}
      {can.link && (
        <Panel title="Link a tech pack" id="tech-pack-link-heading">
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A tech pack started from the buyer&apos;s brief before the order came. Only tech packs
            not linked yet are listed.
          </p>
          <div className="mt-4 grid gap-3">
            <TechPackPicker id="link-tech-pack" value={chosen} onChange={setChosen} />
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !chosen}
                onClick={() =>
                  chosen &&
                  startTransition(async () => {
                    const result = await linkTechPackToProjectAction(chosen.id, {
                      projectId: project.id,
                    });
                    if (!result.ok) return setError(result.error);
                    open(chosen.id);
                  })
                }
              >
                <Link2Icon aria-hidden />
                Link to {project.code}
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {error && (
        <div className="lg:col-span-2">
          <FormAlert>{error.message}</FormAlert>
        </div>
      )}
    </div>
  );
}
