"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { getTaTemplate } from "@/modules/ta/ta.service";
import { saveTaTemplateAction } from "@/server/actions/ta.actions";

type Template = Awaited<ReturnType<typeof getTaTemplate>>;
type Row = Template["steps"][number] & { uid: string };

/** The company's T&A template: its steps (days before the ship date) and the "due soon" days. */
export function TaTemplateForm({ template }: { template: Template }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    template.steps.map((s, i) => ({ ...s, uid: s.id ?? `start-${i}` })),
  );
  const [dueSoon, setDueSoon] = useState(String(template.dueSoonDays));
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string }>();
  const [pending, startTransition] = useTransition();

  const set = (uid: string, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  function save() {
    startTransition(async () => {
      // Kept in the order they happen: the most days before the ship date first.
      const steps = [...rows]
        .sort((a, b) => b.daysBeforeShip - a.daysBeforeShip)
        .map((r) => ({
          id: r.id,
          name: r.name,
          daysBeforeShip: r.daysBeforeShip,
          fact: r.fact,
          critical: r.critical,
          active: r.active,
        }));
      const result = await saveTaTemplateAction({ steps, dueSoonDays: dueSoon });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setMessage({
        tone: "success",
        text: "Saved. New orders get these steps; orders that have their T&A keep it.",
      });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <ol className="grid gap-3">
        {rows.map((r, i) => (
          <li
            key={r.uid}
            className="grid gap-3 rounded-md border p-4 md:grid-cols-[2fr_1fr_2fr] md:items-end"
          >
            <div className="grid gap-2">
              <Label htmlFor={`ta-name-${i}`}>Step</Label>
              <Input
                id={`ta-name-${i}`}
                value={r.name}
                maxLength={80}
                onChange={(e) => set(r.uid, { name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`ta-days-${i}`}>Days before ship date</Label>
              <Input
                id={`ta-days-${i}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={r.daysBeforeShip}
                onChange={(e) => set(r.uid, { daysBeforeShip: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`ta-fact-${i}`}>Ticks itself when</Label>
              <NativeSelect
                id={`ta-fact-${i}`}
                value={r.fact ?? ""}
                containerClassName="w-full"
                onChange={(e) =>
                  set(r.uid, {
                    fact: (e.target.value || null) as Row["fact"],
                  })
                }
              >
                <option value="">Ticked by hand</option>
                {template.facts.map((f) => (
                  <option key={f} value={f}>
                    {template.factLabels[f]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm md:col-span-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.critical}
                  onChange={(e) => set(r.uid, { critical: e.target.checked })}
                />
                On the critical path
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={(e) => set(r.uid, { active: e.target.checked })}
                />
                In use
              </label>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                id: null,
                uid: `new-${Date.now()}`,
                name: "",
                daysBeforeShip: 0,
                fact: null,
                critical: false,
                active: true,
              } as Row,
            ])
          }
        >
          <PlusIcon aria-hidden />
          Add step
        </Button>
      </div>
      <div className="grid max-w-xs gap-2">
        <Label htmlFor="ta-due-soon">Due soon within (days)</Label>
        <Input
          id="ta-due-soon"
          type="number"
          inputMode="numeric"
          min={0}
          max={30}
          value={dueSoon}
          onChange={(e) => setDueSoon(e.target.value)}
        />
      </div>
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      <div>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save the template"}
        </Button>
      </div>
    </div>
  );
}
