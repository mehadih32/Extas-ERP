"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A button for something that comes with the integrations (email, WhatsApp, AI
 * scanning), which are on hold: for now it only says so, and what to do instead.
 */
export function IntegrationPendingButton({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  /** What it will do, and what to do until then. */
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen(true)}
      >
        <Icon aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow text-primary">{label}</p>
            <DialogTitle>Integration Pending</DialogTitle>
            <DialogDescription>{children}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">OK</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
