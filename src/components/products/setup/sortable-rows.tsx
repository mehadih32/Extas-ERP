"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A list reordered by dragging each row's handle (mouse or finger), or from the
 * keyboard: focus the handle, Space to lift, arrows to move, Space to drop.
 * `onMove` gets the ids in their new order.
 */
export function SortableRows({
  id,
  label,
  ids,
  onMove,
  children,
}: {
  /** A stable id, so the server and browser agree on the screen-reader hints. */
  id: string;
  label: string;
  ids: string[];
  onMove: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function end({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onMove(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={end}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To move it, press Space, use the up and down arrows, then press Space again to drop it. Escape cancels.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className="divide-y border-t">
          {children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** One row of a SortableRows list, with its drag handle first. */
export function SortableRow({
  id,
  name,
  disabled,
  className,
  children,
}: {
  id: string;
  /** For the handle's label: "Drag to move XL". */
  name: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex min-h-14 items-center gap-3 bg-card py-2",
        isDragging && "relative z-10 rounded-md shadow-md",
        className,
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to move ${name}`}
        disabled={disabled}
        className="grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25 active:cursor-grabbing disabled:cursor-default disabled:opacity-50 md:size-8"
      >
        <GripVerticalIcon aria-hidden className="size-4" />
      </button>
      {children}
    </li>
  );
}
