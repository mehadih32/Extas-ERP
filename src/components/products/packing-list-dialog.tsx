"use client";

import {
  CircleAlertIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  SparklesIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { reach } from "@/lib/reach";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { PackingListRead, PackingListSetup } from "@/modules/inventory/packing-list.service";
import {
  detectLayout,
  type PackingLayout,
  readBlocks,
  saveLayout,
} from "@/modules/inventory/packing-list/layout";
import {
  blockDoubts,
  blockPieces,
  blockProblems,
  nameKey,
  type PaperBlock,
  parsePaperText,
  renderPaperText,
  rowPieces,
} from "@/modules/inventory/packing-list/paper";
import type { StyleScreen } from "@/modules/inventory/screens.service";
import {
  addPackingListStockAction,
  getPackingListSetupAction,
  getStyleMatrixAction,
  preparePackingStyleAction,
  readPackingListAction,
  readPackingListWithAiAction,
  rememberPackingSourceAction,
} from "@/server/actions/inventory.actions";
import {
  createIntakeAction,
  findProjectsAction,
  uploadProductionFileAction,
} from "@/server/actions/production.actions";

import {
  buyReadyLink,
  type Choice,
  cellsWithPieces,
  codeFromTitle,
  colourChoice,
  sizeChoice,
  styleChoice,
  tidyName,
} from "./packing-list-model";

/*
 * "Upload packing list" (2026-11-12): read a factory's list WITHOUT AI and put
 * its pieces into stock through a flow that already exists.
 *   1. Upload an Excel, CSV, PDF or photo (read on our own server), or type it.
 *   2. Check it: the photo beside "Type it like the paper", the grid with
 *      unsure numbers yellow and totals that do not add up red, the style (or a
 *      new one made here) and the colours and sizes it means.
 *   3. Where the pieces go: a production delivery, Buy ready stock or opening stock.
 */

type Step = "UPLOAD" | "REVIEW";
type Destination = "DELIVERY" | "BUY" | "OPENING";

type BlockState = {
  /** A style id, "NEW", or "" while not picked. */
  style?: string;
  code?: string;
  name?: string;
  categoryId?: string;
  /** Written colour key -> catalog colour id, "NEW" or "". */
  colours: Record<string, string>;
  /** Written colour key -> the name a new colour gets. */
  colourNames: Record<string, string>;
  /** Written size key -> catalog size id, "NEW" or "". */
  sizes: Record<string, string>;
  /** The person checked the paper: its totals are wrong, the grid is right. */
  confirmed?: boolean;
  /** What happened when it was saved. */
  saved?: string;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPT = ".xlsx,.csv,.txt,.tsv,.pdf,image/*";

const emptyState = (): BlockState => ({ colours: {}, colourNames: {}, sizes: {} });

/**
 * A photo ready for the reader: turned the way the person turned it, and
 * scaled so its long side is 1600 to 2400 pixels (small screenshots read
 * better larger; big phone photos upload faster smaller).
 */
async function preparePhoto(file: File, rotation: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    const scale = long > 2400 ? 2400 / long : long < 1600 ? 1600 / long : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const turned = rotation % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.width = turned ? h : w;
    canvas.height = turned ? w : h;
    const g = canvas.getContext("2d");
    if (!g) return file;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.translate(canvas.width / 2, canvas.height / 2);
    g.rotate((rotation * Math.PI) / 180);
    g.drawImage(bitmap, -w / 2, -h / 2, w, h);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.92),
    );
  } catch {
    return file;
  }
}

function Choices<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm md:min-h-9",
              value === o.value ? "border-primary/40 bg-secondary" : "hover:bg-muted",
            )}
          >
            <input
              type="radio"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="size-4 cursor-pointer accent-primary"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const choiceTone = (how: Choice["how"] | undefined, value: string) =>
  !value
    ? "border-destructive bg-destructive/5"
    : how === "GUESS" || how === "NEW"
      ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40"
      : "";

export function PackingListDialog({
  screen,
  onClose,
  onSaved,
}: {
  screen: StyleScreen;
  onClose: () => void;
  onSaved: (notice: string) => void;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<PackingListSetup | null>(null);
  const [step, setStep] = useState<Step>("UPLOAD");
  const [file, setFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [source, setSource] = useState("");
  const [read, setRead] = useState<PackingListRead | null>(null);
  const [layout, setLayout] = useState<PackingLayout | null>(null);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [states, setStates] = useState<Record<number, BlockState>>({});
  const [destination, setDestination] = useState<Destination>("OPENING");
  const [warehouseId, setWarehouseId] = useState(screen.warehouseId ?? "");
  const [projects, setProjects] = useState<Array<{ id: string; code: string; name: string }>>();
  const [projectId, setProjectId] = useState("");
  const [grade, setGrade] = useState<"A_GRADE" | "B_GRADE">("A_GRADE");
  const [unitCost, setUnitCost] = useState("");
  const [problem, setProblem] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void reach(() => getPackingListSetupAction()).then((result) => {
      if (!live) return;
      if (result.ok) {
        setSetup(result.data);
        setWarehouseId(
          (w) =>
            w ||
            result.data.warehouses.find((x) => x.isDefault)?.id ||
            result.data.warehouses[0]?.id ||
            "",
        );
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  // The photo's preview link is let go when another file is chosen or the window closes.
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  function chooseFile(chosen: File | null) {
    setFile(chosen);
    setPhotoUrl(chosen && IMAGE_TYPES.includes(chosen.type) ? URL.createObjectURL(chosen) : null);
    setRotation(0);
    setZoom(1);
    setProblem(undefined);
  }

  useEffect(() => {
    if (destination !== "DELIVERY" || projects) return;
    void reach(() => findProjectsAction({ purpose: "RECEIVE" })).then((result) => {
      if (result.ok) {
        setProjects(result.data);
        setProjectId((p) => p || result.data[0]?.id || "");
      } else setError(result.error);
    });
  }, [destination, projects]);

  const sizeNames = useMemo(() => setup?.sizes.map((s) => s.name) ?? [], [setup]);
  const paper = useMemo(() => parsePaperText(text, sizeNames), [text, sizeNames]);
  const allPieces = paper.blocks.reduce((s, b) => s + blockPieces(b), 0);
  const block: PaperBlock | undefined = paper.blocks[Math.min(active, paper.blocks.length - 1)];
  const blockIndex = Math.min(active, Math.max(paper.blocks.length - 1, 0));
  const state = states[blockIndex] ?? emptyState();
  const remembered = useMemo(() => read?.source?.colours ?? {}, [read]);
  const pageStyle = screen.style;

  /** The choices for the shown block: the person's, else the best guess. */
  const choice = useMemo(() => {
    if (!block || !setup) return null;
    const styleGuess = styleChoice(block, setup.styles, pageStyle);
    const style = state.style ?? styleGuess.value;
    const colours = new Map<string, Choice>();
    for (const row of block.rows) {
      const key = nameKey(row.colour);
      if (colours.has(key)) continue;
      const own = state.colours[key];
      colours.set(
        key,
        own !== undefined
          ? { value: own, how: own === "NEW" ? "NEW" : "SAME" }
          : colourChoice(row.colour, setup.colours, remembered),
      );
    }
    const sizes = new Map<string, Choice>();
    for (const size of block.sizes) {
      const key = nameKey(size);
      const own = state.sizes[key];
      sizes.set(
        key,
        own !== undefined
          ? { value: own, how: own === "NEW" ? "NEW" : "SAME" }
          : sizeChoice(size, setup.sizes),
      );
    }
    return { style, suggestions: styleGuess.suggestions, colours, sizes };
  }, [block, setup, state, remembered, pageStyle]);

  const problems = block ? blockProblems(block, allPieces) : [];
  const doubts = block ? blockDoubts(block) : [];

  function update(next: Partial<BlockState>) {
    setStates((all) => ({
      ...all,
      [blockIndex]: { ...(all[blockIndex] ?? emptyState()), ...next },
    }));
    setProblem(undefined);
  }

  /** A grid edit rewrites the text, so the text and the grid always say the same. */
  function setCell(rowIndex: number, sizeIndex: number, value: string) {
    if (!block) return;
    const trimmed = value.trim();
    const pieces = trimmed === "" ? null : /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : NaN;
    if (Number.isNaN(pieces)) return;
    const blocks = paper.blocks.map((b, i) =>
      i !== blockIndex
        ? b
        : {
            ...b,
            rows: b.rows.map((r, j) => {
              if (j !== rowIndex) return r;
              const cells = [...r.cells];
              while (cells.length <= sizeIndex) cells.push({ pieces: null, unsure: null });
              cells[sizeIndex] = { pieces, unsure: null };
              return { ...r, cells };
            }),
          },
    );
    setText(renderPaperText(blocks));
  }

  function changeLayout(next: PackingLayout) {
    setLayout(next);
    if (read?.table) setText(renderPaperText(readBlocks(read.table, next)));
  }

  function readFile(withAi: boolean, turn = rotation) {
    if (!file) {
      setProblem("Choose the packing list's file or photo first.");
      return;
    }
    startTransition(async () => {
      const form = new FormData();
      const photo = IMAGE_TYPES.includes(file.type) ? await preparePhoto(file, turn) : file;
      form.set("file", photo, file.name);
      form.set("source", source.trim());
      if (withAi) {
        const result = await readPackingListWithAiAction(form);
        if (!result.ok) return setError(result.error);
        setRead(null);
        setLayout(null);
        setText(result.data.text);
        setNotes(result.data.notes);
      } else {
        const result = await readPackingListAction(form);
        if (!result.ok) return setError(result.error);
        setRead(result.data);
        setLayout(result.data.layout);
        setText(result.data.text);
        setNotes([
          ...result.data.notes,
          ...(result.data.layoutFrom === "SAVED"
            ? [`The columns were set as on ${result.data.source?.name}'s last list.`]
            : []),
        ]);
      }
      setStates({});
      setActive(0);
      setError(undefined);
      setStep("REVIEW");
    });
  }

  function typeIt() {
    setRead(null);
    setLayout(null);
    setText(`${pageStyle.code}\nS M L XL XXL\n`);
    setNotes([]);
    setStep("REVIEW");
  }

  function save() {
    if (!block || !choice || !setup) return;
    const cells = cellsWithPieces(block);
    if (cells.length === 0) return setProblem("This style has no pieces to save.");
    if (!choice.style) return setProblem("Pick the style, or make a new one.");
    if (choice.style === "NEW") {
      const code = state.code ?? codeFromTitle(block.title ?? "");
      if (!code || !(state.name ?? block.title) || !(state.categoryId ?? setup.categories[0]?.id)) {
        return setProblem("Give the new style a code, a name and a category.");
      }
    }
    const used = new Set(cells.map((c) => nameKey(c.colour)));
    const unpicked = block.rows.filter(
      (r) => used.has(nameKey(r.colour)) && !choice.colours.get(nameKey(r.colour))?.value,
    );
    if (unpicked.length) {
      return setProblem(`Pick the colour for ${unpicked.map((r) => r.colour).join(", ")}.`);
    }
    const unsized = block.sizes.filter((s) => !choice.sizes.get(nameKey(s))?.value);
    if (unsized.length) return setProblem(`Pick the size for ${unsized.join(", ")}.`);
    if (problems.length > 0 && !state.confirmed) {
      return setProblem(
        "The totals do not add up. Fix the numbers, or tick that the paper's totals are wrong.",
      );
    }
    if (destination === "DELIVERY" && !projectId) {
      return setProblem("Pick the production project the pieces came from.");
    }

    startTransition(async () => {
      // 1. The style ready: new or picked, with the list's colours and sizes on it.
      const colourOf = (written: string) => {
        const key = nameKey(written);
        const value = choice.colours.get(key)!.value;
        const name =
          value === "NEW"
            ? (state.colourNames[key] ?? tidyName(written))
            : (setup.colours.find((c) => c.id === value)?.name ?? written);
        return { key, value, name };
      };
      const sizeOf = (written: string) => {
        const key = nameKey(written);
        const value = choice.sizes.get(key)!.value;
        const name =
          value === "NEW"
            ? written.toUpperCase()
            : (setup.sizes.find((s) => s.id === value)?.name ?? written);
        return { key, value, name };
      };
      const colours = [
        ...new Map(cells.map((c) => [nameKey(c.colour), colourOf(c.colour)])).values(),
      ];
      const sizes = [...new Map(cells.map((c) => [nameKey(c.size), sizeOf(c.size)])).values()];
      const prepared = await preparePackingStyleAction({
        style:
          choice.style === "NEW"
            ? {
                mode: "NEW",
                code: state.code ?? codeFromTitle(block.title ?? ""),
                name: state.name ?? block.title ?? "",
                categoryId: state.categoryId ?? setup.categories[0]?.id ?? "",
              }
            : { mode: "PICK", styleId: choice.style },
        colours: colours.map((c) => ({
          ...(c.value !== "NEW" ? { colorId: c.value } : {}),
          name: c.name,
        })),
        sizes: sizes.map((s) => ({
          ...(s.value !== "NEW" ? { sizeId: s.value } : {}),
          name: s.name,
        })),
      });
      if (!prepared.ok) return setError(prepared.error);
      const { styleId, colourIds, sizeIds } = prepared.data;
      const colourId = new Map(colours.map((c) => [c.key, colourIds[c.name]!]));
      const sizeId = new Map(sizes.map((s) => [s.key, sizeIds[s.name]!]));
      const merged = new Map<string, { colorId: string; sizeId: string; pieces: number }>();
      for (const c of cells) {
        const colorId = colourId.get(nameKey(c.colour))!;
        const size = sizeId.get(nameKey(c.size))!;
        const key = `${colorId}:${size}`;
        const was = merged.get(key);
        if (was) was.pieces += c.pieces;
        else merged.set(key, { colorId, sizeId: size, pieces: c.pieces });
      }
      const chosen = [...merged.values()];

      // 2. Remember this factory's columns and colour spellings for its next list.
      if (source.trim()) {
        await rememberPackingSourceAction({
          source: source.trim(),
          layout: read?.table && layout ? saveLayout(read.table, layout) : undefined,
          colours: Object.fromEntries(
            block.rows.flatMap((r) => {
              const id = colourId.get(nameKey(r.colour));
              return id ? [[r.colour, id]] : [];
            }),
          ),
        });
      }

      // 3. Where the pieces go, through the flow that already exists.
      const pieces = chosen.reduce((s, c) => s + c.pieces, 0);
      if (destination === "BUY") {
        router.push(buyReadyLink(styleId, chosen));
        return;
      }
      if (destination === "DELIVERY") {
        const matrix = await getStyleMatrixAction(styleId);
        if (!matrix.ok) return setError(matrix.error);
        const variantOf = new Map(
          matrix.data.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell ? [[`${row.color.id}:${cell.sizeId}`, cell.variantId]] : [],
            ),
          ),
        );
        let sourceFileId: string | undefined;
        if (file && (IMAGE_TYPES.includes(file.type) || file.type === "application/pdf")) {
          const form = new FormData();
          form.set("file", file, file.name);
          const uploaded = await uploadProductionFileAction(form);
          if (uploaded.ok) sourceFileId = uploaded.data.id;
        }
        const created = await createIntakeAction({
          projectId,
          warehouseId: warehouseId || undefined,
          sourceFileId,
          parse: false,
          notes: "From an uploaded packing list",
          lines: chosen.map((c) => ({
            variantId: variantOf.get(`${c.colorId}:${c.sizeId}`) ?? "",
            grade,
            quantity: c.pieces,
          })),
        });
        if (!created.ok) return setError(created.error);
        router.push(`/production/deliveries/${created.data.id}`);
        return;
      }
      const result = await addPackingListStockAction({
        styleId,
        warehouseId: warehouseId || undefined,
        grade,
        unitCost: unitCost.trim() ? Number(unitCost) : undefined,
        note: source.trim() ? `Packing list from ${source.trim()}` : undefined,
        cells: chosen,
      });
      if (!result.ok) return setError(result.error);
      const done = `${pieces} pieces added to stock`;
      update({ saved: done });
      const left = paper.blocks.findIndex((_, i) => i !== blockIndex && !states[i]?.saved);
      if (left >= 0) setActive(left);
      else onSaved(`${done} from the packing list.`);
    });
  }

  const canAi = setup?.ai.on ?? false;
  const isPhoto = Boolean(photoUrl);
  const table = read?.table ?? null;
  const header = table && layout ? (table.rows[layout.headerRow] ?? []) : [];
  const columnName = (c: number) =>
    `${String.fromCharCode(65 + (c % 26))}${c >= 26 ? Math.floor(c / 26) : ""}: ${header[c]?.text || "(blank)"}`;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Upload packing list</DialogTitle>
          <DialogDescription>
            {step === "UPLOAD"
              ? "Excel, CSV, PDF or a photo of the paper. It is read on our own server, without AI; you check every line before anything is saved."
              : "Check the lines against the paper. Yellow: please look. Red: the totals do not add up."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain px-2 py-1">
          {!setup ? (
            <Skeleton className="h-40 w-full" />
          ) : step === "UPLOAD" ? (
            <div className="grid gap-4 sm:max-w-xl">
              <Field
                id="pl-source"
                label="From (factory or supplier)"
                hint="Optional. Its columns and colour names are remembered for its next list."
              >
                <Input
                  id="pl-source"
                  list="pl-sources"
                  value={source}
                  maxLength={120}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Like: Rahman Knit"
                />
                <datalist id="pl-sources">
                  {setup.sources.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field id="pl-file" label="Packing list file or photo">
                <Input
                  id="pl-file"
                  type="file"
                  accept={ACCEPT}
                  onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" disabled={pending} onClick={() => readFile(false)}>
                  {pending ? (
                    <LoaderCircleIcon className="animate-spin" aria-hidden />
                  ) : (
                    <UploadIcon aria-hidden />
                  )}
                  {pending ? "Reading" : "Read the list"}
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={typeIt}>
                  Type it without a file
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !canAi}
                  onClick={() => readFile(true)}
                  title={canAi ? undefined : setup.ai.on ? undefined : setup.ai.why}
                >
                  <SparklesIcon aria-hidden />
                  Read with AI
                </Button>
              </div>
              {!setup.ai.on && (
                <p className="text-sm text-muted-foreground">
                  “Read with AI” works only while AI is on. {setup.ai.why} “Read the list” works
                  without it.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="grid content-start gap-4">
                {photoUrl && (
                  <section aria-label="The photo" className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRotation((r) => (r + 90) % 360)}
                      >
                        <RotateCwIcon aria-hidden />
                        Turn
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="Zoom in"
                        onClick={() => setZoom((z) => Math.min(z + 0.5, 4))}
                      >
                        <ZoomInIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="Zoom out"
                        onClick={() => setZoom((z) => Math.max(z - 0.5, 1))}
                      >
                        <ZoomOutIcon aria-hidden />
                      </Button>
                      {rotation !== 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => readFile(false, rotation)}
                        >
                          Read again
                        </Button>
                      )}
                    </div>
                    <div className="max-h-[22rem] overflow-auto rounded-md border bg-muted/40 lg:max-h-[32rem]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
                      <img
                        src={photoUrl}
                        alt="The packing list as uploaded"
                        className="origin-top-left transition-transform"
                        style={{
                          width: `${zoom * 100}%`,
                          maxWidth: "none",
                          transform: rotation ? `rotate(${rotation}deg)` : undefined,
                          transformOrigin: "center",
                        }}
                      />
                    </div>
                  </section>
                )}
                {table && layout && (
                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Columns</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field id="pl-kind" label="Layout">
                        <NativeSelect
                          id="pl-kind"
                          value={layout.kind}
                          onChange={(e) => {
                            const kind = e.target.value as PackingLayout["kind"];
                            changeLayout({
                              ...layout,
                              kind,
                              size: layout.size ?? 0,
                              pieces: layout.pieces ?? 0,
                            });
                          }}
                        >
                          <option value="GRID">Sizes across</option>
                          <option value="LIST">One row per size</option>
                        </NativeSelect>
                      </Field>
                      <Field id="pl-header" label="Header row">
                        <Input
                          id="pl-header"
                          inputMode="numeric"
                          value={String(layout.headerRow + 1)}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n >= 1 && n <= table.rows.length) {
                              const found = detectLayout(
                                { ...table, rows: table.rows.slice(n - 1) },
                                sizeNames,
                              );
                              changeLayout(
                                found && found.headerRow === 0
                                  ? { ...found, headerRow: n - 1 }
                                  : { ...layout, headerRow: n - 1 },
                              );
                            }
                          }}
                        />
                      </Field>
                      {(
                        [
                          ["colour", "Colour column"],
                          ["style", "Style column"],
                          ...(layout.kind === "LIST"
                            ? ([
                                ["size", "Size column"],
                                ["pieces", "Pieces column"],
                              ] as const)
                            : []),
                        ] as const
                      ).map(([role, label]) => (
                        <Field key={role} id={`pl-col-${role}`} label={label}>
                          <NativeSelect
                            id={`pl-col-${role}`}
                            value={layout[role] === null ? "" : String(layout[role])}
                            onChange={(e) =>
                              changeLayout({
                                ...layout,
                                [role]: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          >
                            <option value="">None</option>
                            {header.map((_, c) => (
                              <option key={c} value={c}>
                                {columnName(c)}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      ))}
                    </div>
                    {layout.kind === "GRID" && (
                      <fieldset className="mt-3 grid gap-2">
                        <legend className="font-medium">Size columns</legend>
                        <div className="flex flex-wrap gap-2">
                          {header.map((cell, c) =>
                            c === layout.colour || c === layout.style ? null : (
                              <label
                                key={c}
                                className="flex min-h-9 items-center gap-2 rounded-md border px-2.5"
                              >
                                <input
                                  type="checkbox"
                                  className="size-4 accent-primary"
                                  checked={layout.sizeColumns.includes(c)}
                                  onChange={(e) =>
                                    changeLayout({
                                      ...layout,
                                      sizeColumns: e.target.checked
                                        ? [...layout.sizeColumns, c].sort((a, b) => a - b)
                                        : layout.sizeColumns.filter((x) => x !== c),
                                    })
                                  }
                                />
                                {cell.text || columnName(c)}
                              </label>
                            ),
                          )}
                        </div>
                      </fieldset>
                    )}
                  </details>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="pl-text">Type it like the paper</Label>
                  <Textarea
                    id="pl-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={isPhoto ? 10 : 8}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="font-mono"
                    placeholder={
                      "HOODY-ZIP\nS M L XL XXL\nNavy 3-14-13-6-5 = 41\nBlack 20 58 - 40 20 = 138"
                    }
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    One line for the style, one for the sizes, then one per colour: “Navy
                    3-14-13-6-5 = 41”. A “-” alone is none; “= 41” is the total on the paper; put
                    “?” after a number you are not sure of.
                  </p>
                </div>
                {notes.map((n) => (
                  <FormAlert key={n} tone="note">
                    {n}
                  </FormAlert>
                ))}
                {paper.skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Not read as pieces:{" "}
                    {paper.skipped.map((s) => `line ${s.line} (${s.why.toLowerCase()})`).join(", ")}
                    .
                  </p>
                )}
              </div>

              <div className="grid content-start gap-4">
                {paper.blocks.length === 0 || !block || !choice ? (
                  <FormAlert tone="note">
                    Nothing to check yet. Type the lines as on the paper: the style, the sizes, then
                    one line per colour.
                  </FormAlert>
                ) : (
                  <>
                    {paper.blocks.length > 1 && (
                      <div
                        className="flex flex-wrap gap-2"
                        role="tablist"
                        aria-label="Styles on this list"
                      >
                        {paper.blocks.map((b, i) => (
                          <Button
                            key={i}
                            type="button"
                            size="sm"
                            role="tab"
                            aria-selected={i === blockIndex}
                            variant={i === blockIndex ? "default" : "outline"}
                            onClick={() => setActive(i)}
                          >
                            {b.title ?? `Style ${i + 1}`}
                            {states[i]?.saved ? " (saved)" : ""}
                          </Button>
                        ))}
                      </div>
                    )}

                    <section aria-label="Style" className="grid gap-3 rounded-md border p-3">
                      {block.title && (
                        <p className="text-sm">
                          Written on the paper: <span className="font-medium">{block.title}</span>
                        </p>
                      )}
                      {choice.suggestions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Closest styles:</span>
                          {choice.suggestions.map((s) => (
                            <Button
                              key={s.id}
                              type="button"
                              size="sm"
                              variant={choice.style === s.id ? "default" : "outline"}
                              onClick={() => update({ style: s.id })}
                            >
                              {s.code}
                            </Button>
                          ))}
                        </div>
                      )}
                      <Field id="pl-style" label="Style">
                        <NativeSelect
                          id="pl-style"
                          value={choice.style}
                          onChange={(e) => update({ style: e.target.value })}
                          className={cn(!choice.style && "border-destructive")}
                        >
                          <option value="">Pick the style</option>
                          <option value="NEW">Create new style</option>
                          {setup.styles.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code} · {s.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      {choice.style === "NEW" && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field id="pl-new-code" label="Style code">
                            <Input
                              id="pl-new-code"
                              value={state.code ?? codeFromTitle(block.title ?? "")}
                              maxLength={40}
                              onChange={(e) => update({ code: e.target.value.toUpperCase() })}
                            />
                          </Field>
                          <Field id="pl-new-name" label="Style name">
                            <Input
                              id="pl-new-name"
                              value={state.name ?? block.title ?? ""}
                              maxLength={120}
                              onChange={(e) => update({ name: e.target.value })}
                            />
                          </Field>
                          <Field id="pl-new-category" label="Category">
                            <NativeSelect
                              id="pl-new-category"
                              value={state.categoryId ?? setup.categories[0]?.id ?? ""}
                              onChange={(e) => update({ categoryId: e.target.value })}
                            >
                              {setup.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                            </NativeSelect>
                          </Field>
                          <p className="text-xs text-muted-foreground sm:col-span-3">
                            The new style gets this list&apos;s colours and sizes. Prices and the
                            rest can be added on its page later.
                          </p>
                        </div>
                      )}
                    </section>

                    <div className="overflow-x-auto rounded-lg border bg-card">
                      <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
                        <caption className="sr-only">Pieces by colour and size, as read</caption>
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              className="sticky left-0 z-10 min-w-[9rem] border-r border-b bg-card px-2 py-2 text-left text-xs font-medium text-muted-foreground uppercase"
                            >
                              Colour
                            </th>
                            {block.sizes.map((size) => {
                              const key = nameKey(size);
                              const c = choice.sizes.get(key);
                              return (
                                <th
                                  key={key}
                                  scope="col"
                                  className="min-w-[5rem] border-b px-1 py-2 text-xs font-medium"
                                >
                                  <NativeSelect
                                    aria-label={`Size “${size}” on the paper`}
                                    value={c?.value ?? ""}
                                    onChange={(e) =>
                                      update({ sizes: { ...state.sizes, [key]: e.target.value } })
                                    }
                                    className={cn(
                                      "h-8 px-1.5 text-xs",
                                      choiceTone(c?.how, c?.value ?? ""),
                                    )}
                                  >
                                    <option value="">{size}?</option>
                                    <option value="NEW">New: {size.toUpperCase()}</option>
                                    {setup.sizes.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </th>
                              );
                            })}
                            <th
                              scope="col"
                              className="border-b border-l bg-muted/40 px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase"
                            >
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((row, r) => {
                            const key = nameKey(row.colour);
                            const c = choice.colours.get(key);
                            const sum = rowPieces(row);
                            const wrong = row.writtenTotal !== null && row.writtenTotal !== sum;
                            return (
                              <tr key={`${key}:${r}`} className={cn(wrong && "bg-destructive/5")}>
                                <th
                                  scope="row"
                                  className="sticky left-0 z-10 border-r border-b bg-card px-2 py-1.5 text-left font-normal"
                                >
                                  <span className="block text-xs text-muted-foreground">
                                    {row.colour}
                                  </span>
                                  <NativeSelect
                                    aria-label={`Colour “${row.colour}” on the paper`}
                                    value={c?.value ?? ""}
                                    onChange={(e) =>
                                      update({
                                        colours: { ...state.colours, [key]: e.target.value },
                                      })
                                    }
                                    className={cn(
                                      "mt-1 h-8 px-1.5 text-xs",
                                      choiceTone(c?.how, c?.value ?? ""),
                                    )}
                                  >
                                    <option value="">Pick a colour</option>
                                    <option value="NEW">
                                      New colour: {state.colourNames[key] ?? tidyName(row.colour)}
                                    </option>
                                    {setup.colours.map((x) => (
                                      <option key={x.id} value={x.id}>
                                        {x.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                  {c?.value === "NEW" && (
                                    <Input
                                      aria-label={`Name of the new colour for “${row.colour}”`}
                                      value={state.colourNames[key] ?? tidyName(row.colour)}
                                      maxLength={40}
                                      onChange={(e) =>
                                        update({
                                          colourNames: {
                                            ...state.colourNames,
                                            [key]: e.target.value,
                                          },
                                        })
                                      }
                                      className="mt-1 h-8 text-xs"
                                    />
                                  )}
                                </th>
                                {block.sizes.map((size, i) => {
                                  const cell = row.cells[i];
                                  return (
                                    <td key={nameKey(size)} className="border-b px-1 py-1.5">
                                      <Input
                                        inputMode="numeric"
                                        autoComplete="off"
                                        aria-label={`${row.colour}, ${size}`}
                                        title={cell?.unsure ?? undefined}
                                        value={
                                          cell?.pieces === null || cell?.pieces === undefined
                                            ? ""
                                            : String(cell.pieces)
                                        }
                                        onChange={(e) => setCell(r, i, e.target.value)}
                                        className={cn(
                                          "h-9 min-w-[3.5rem] px-2 text-right tabular-nums md:h-8",
                                          cell?.unsure &&
                                            "border-amber-400 bg-amber-50 dark:bg-amber-950/40",
                                        )}
                                      />
                                    </td>
                                  );
                                })}
                                <td
                                  className={cn(
                                    "border-b border-l bg-muted/40 px-2 text-right font-medium",
                                    wrong && "text-destructive",
                                  )}
                                >
                                  {sum}
                                  {row.writtenTotal !== null && (
                                    <span className="block text-xs font-normal">
                                      paper {row.writtenTotal}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th
                              scope="row"
                              className="sticky left-0 z-10 border-r bg-muted px-2 py-2 text-left text-xs font-medium uppercase"
                            >
                              Total
                            </th>
                            {block.sizes.map((size, i) => (
                              <td
                                key={nameKey(size)}
                                className="bg-muted/40 px-2 py-2 text-right font-medium"
                              >
                                {block.rows.reduce((s, r) => s + (r.cells[i]?.pieces ?? 0), 0)}
                              </td>
                            ))}
                            <td className="border-l bg-muted px-2 py-2 text-right font-serif text-lg">
                              {blockPieces(block)}
                              {block.writtenTotal !== null && (
                                <span className="block font-sans text-xs">
                                  paper {block.writtenTotal}
                                </span>
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {problems.length > 0 && (
                      <div
                        role="alert"
                        className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                      >
                        <p className="flex items-center gap-2 font-medium text-destructive">
                          <CircleAlertIcon aria-hidden className="size-4" />
                          The totals do not add up
                        </p>
                        <ul className="list-disc pl-5">
                          {problems.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-primary"
                            checked={Boolean(state.confirmed)}
                            onChange={(e) => update({ confirmed: e.target.checked })}
                          />
                          I checked the paper: its totals are wrong, the pieces in the grid are
                          right
                        </label>
                      </div>
                    )}
                    {doubts.length > 0 && (
                      <FormAlert tone="note">
                        {doubts.length} {doubts.length === 1 ? "number needs" : "numbers need"} a
                        look (yellow). Check {doubts.length === 1 ? "it" : "them"} against the
                        paper.
                      </FormAlert>
                    )}

                    {state.saved ? (
                      <FormAlert tone="success">{state.saved}.</FormAlert>
                    ) : (
                      <section
                        aria-label="Where the pieces go"
                        className="grid gap-3 rounded-md border p-3"
                      >
                        <Choices
                          legend="Where do the pieces go?"
                          value={destination}
                          onChange={setDestination}
                          options={[
                            ...(setup.can.deliver
                              ? [{ value: "DELIVERY" as const, label: "Production delivery" }]
                              : []),
                            ...(setup.can.buy
                              ? [{ value: "BUY" as const, label: "Buy ready stock" }]
                              : []),
                            { value: "OPENING" as const, label: "Opening stock" },
                          ]}
                        />
                        <p className="text-sm text-muted-foreground">
                          {destination === "DELIVERY"
                            ? "Makes a draft delivery for the project with these pieces. Check it and confirm it there, as with any delivery."
                            : destination === "BUY"
                              ? "Opens the Buy ready stock form with this style and these pieces filled in. Add the supplier, price and payment there."
                              : "Adds the pieces to stock now as opening stock (as Bulk update and stock counts do), at the cost you give or the style's average cost."}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {destination === "DELIVERY" && (
                            <Field id="pl-project" label="Production project">
                              {!projects ? (
                                <Skeleton className="h-9 w-full" />
                              ) : (
                                <NativeSelect
                                  id="pl-project"
                                  value={projectId}
                                  onChange={(e) => setProjectId(e.target.value)}
                                >
                                  {projects.length === 0 && (
                                    <option value="">No project is receiving goods</option>
                                  )}
                                  {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.code} · {p.name}
                                    </option>
                                  ))}
                                </NativeSelect>
                              )}
                            </Field>
                          )}
                          {destination !== "BUY" && setup.warehouses.length > 1 && (
                            <Field id="pl-warehouse" label="Warehouse">
                              <NativeSelect
                                id="pl-warehouse"
                                value={warehouseId}
                                onChange={(e) => setWarehouseId(e.target.value)}
                              >
                                {setup.warehouses.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                          )}
                          {destination !== "BUY" && (
                            <Field id="pl-grade" label="Grade">
                              <NativeSelect
                                id="pl-grade"
                                value={grade}
                                onChange={(e) => setGrade(e.target.value as typeof grade)}
                              >
                                <option value="A_GRADE">Good (A-grade)</option>
                                <option value="B_GRADE">B-grade</option>
                              </NativeSelect>
                            </Field>
                          )}
                          {destination === "OPENING" && (
                            <Field id="pl-cost" label="Cost per piece (optional)">
                              <Input
                                id="pl-cost"
                                inputMode="decimal"
                                value={unitCost}
                                onChange={(e) => setUnitCost(e.target.value)}
                                placeholder="The style's average cost"
                              />
                            </Field>
                          )}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 border-t pt-4">
          {problem && <FormAlert>{problem}</FormAlert>}
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            {step === "REVIEW" && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setStep("UPLOAD")}
              >
                Back
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {step === "REVIEW" && Object.values(states).some((s) => s.saved) ? "Done" : "Cancel"}
            </Button>
            {step === "REVIEW" && block && !state.saved && (
              <Button type="button" disabled={pending} onClick={save}>
                {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                {pending ? "Saving" : "Save these pieces"}
              </Button>
            )}
          </DialogFooter>
        </div>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="The packing list could not be read or saved"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
