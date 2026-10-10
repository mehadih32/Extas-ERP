"use client";

import { MailIcon } from "lucide-react";
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
 * The Email button for a 360° profile. Sending email comes with the
 * integrations, which are on hold, so for now it only says so.
 */
export function EmailPendingButton({
  what,
  className,
}: {
  /** What would be emailed: "Rahim Traders' 360° profile". */
  what: string;
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
        <MailIcon aria-hidden />
        Email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow text-primary">Email</p>
            <DialogTitle>Integration Pending</DialogTitle>
            <DialogDescription>
              Sending {what} by email comes with the integrations, which are on hold for now. Until
              then, download the PDF and attach it to your email.
            </DialogDescription>
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
