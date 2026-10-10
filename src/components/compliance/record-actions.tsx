"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  FileUpIcon,
  LoaderCircleIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { useNotice } from "@/components/hr/use-notice";
import { fileSize } from "@/components/reports/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import type { ComplianceRecordScreen } from "@/modules/compliance/screens.service";
import {
  archiveComplianceAction,
  attachComplianceScanAction,
  deleteComplianceAction,
  removeComplianceScanAction,
  restoreComplianceAction,
} from "@/server/actions/compliance.actions";

import { ComplianceDialog, RenewDialog } from "./forms";
import { complianceHref } from "./labels";

/**
 * What may be done with a licence record (compliance.manage), from the flags
 * its screen came with: renew the term in force, correct it, archive or
 * restore it, delete it.
 */
export function RecordActions({
  screen,
  today,
  notice: initial,
}: {
  screen: ComplianceRecordScreen;
  today: string;
  notice?: string;
}) {
  const router = useRouter();
  const { record: r, can } = screen;
  const [open, setOpen] = useState<"edit" | "renew" | "archive" | "restore" | "delete" | null>(
    null,
  );
  const [notice, setNotice] = useNotice(initial);
  const close = () => setOpen(null);
  const menu = can.archive || can.restore || can.delete;

  if (!can.renew && !can.edit && !menu) {
    return notice ? <FormAlert tone="success">{notice}</FormAlert> : null;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.renew && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("renew")}>
            <RefreshCwIcon aria-hidden />
            Renew
          </Button>
        )}
        <div className="flex gap-2">
          {can.edit && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen("edit")}
            >
              <PencilIcon aria-hidden />
              Correct
            </Button>
          )}
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={`More for ${r.title}`}>
                  <EllipsisVerticalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {can.archive && (
                  <DropdownMenuItem onSelect={() => setOpen("archive")}>
                    <ArchiveIcon aria-hidden />
                    Archive
                  </DropdownMenuItem>
                )}
                {can.restore && (
                  <DropdownMenuItem onSelect={() => setOpen("restore")}>
                    <ArchiveRestoreIcon aria-hidden />
                    Restore
                  </DropdownMenuItem>
                )}
                {can.delete && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                    <Trash2Icon aria-hidden />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "edit" && (
        <ComplianceDialog
          record={r}
          onClose={close}
          onDone={(message) => {
            setNotice(message);
            close();
          }}
        />
      )}
      {open === "renew" && (
        <RenewDialog
          record={r}
          today={today}
          onClose={close}
          onDone={(id) => router.push(`${complianceHref.record(id)}?renewed=1`)}
        />
      )}
      {open === "archive" && (
        <ConfirmDialog
          title="Archive this record?"
          description="It comes off the list and its reminders stop. It stays in the history and can be restored."
          confirmLabel="Archive"
          pendingLabel="Archiving"
          errorTitle="We could not archive the record"
          onClose={close}
          onConfirm={async () => {
            const result = await archiveComplianceAction(r.id);
            if (!result.ok) return result.error;
            setNotice("Archived. Its reminders have stopped.");
            close();
          }}
        />
      )}
      {open === "restore" && (
        <ConfirmDialog
          title="Restore this record?"
          description="It goes back on the list, and reminders start again as its expiry comes near."
          confirmLabel="Restore"
          pendingLabel="Restoring"
          errorTitle="We could not restore the record"
          onClose={close}
          onConfirm={async () => {
            const result = await restoreComplianceAction(r.id);
            if (!result.ok) return result.error;
            setNotice("Restored.");
            close();
          }}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title="Delete this record?"
          description={
            r.previous
              ? "It is removed for good, with its scan and reminders, and the term before it is in force again. Archive it instead to keep it as history."
              : "It is removed for good, with its scan and reminders. Archive it instead to keep it as history."
          }
          confirmLabel="Delete the record"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the record"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteComplianceAction(r.id);
            if (!result.ok) return result.error;
            router.push(r.previous ? complianceHref.record(r.previous.id) : complianceHref.list);
          }}
        />
      )}
    </div>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The record's scan: open or save it (compliance.view), upload, replace or
 * remove it (compliance.manage). A photo (JPG, PNG or WebP) or a PDF of up to
 * 10 MB.
 */
export function ScanPanel({
  recordId,
  scan,
  canChange,
}: {
  recordId: string;
  scan: ComplianceRecordScreen["record"]["scan"];
  canChange: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [confirmRemove, setConfirmRemove] = useState(false);

  function upload(file: File | undefined) {
    if (!file) return;
    if (input.current) input.current.value = "";
    if (file.size > MAX_BYTES) {
      setProblem("A scan can be up to 10 MB.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await attachComplianceScanAction(recordId, form);
      if (!result.ok) {
        if (result.error.code === "VALIDATION") setProblem(result.error.message);
        else setError(result.error);
        return;
      }
      setProblem(undefined);
    });
  }

  return (
    <div className="grid gap-3">
      {scan ? (
        <div className="grid gap-3">
          <p className="text-sm break-words">
            {scan.fileName}
            <span className="block text-[0.8125rem] text-muted-foreground">
              {scan.mimeType === "application/pdf" ? "PDF" : "Photo"}
              {scan.sizeBytes !== null && ` · ${fileSize(scan.sizeBytes)}`}
            </span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={complianceHref.scan(recordId, scan.id)} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden />
                Open the scan
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={complianceHref.scan(recordId, scan.id, true)} download>
                <DownloadIcon aria-hidden />
                Download
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canChange
            ? "No scan yet. Add a photo or PDF of the certificate."
            : "No scan has been added yet."}
        </p>
      )}
      {canChange && (
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant={scan ? "outline" : "default"}
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <FileUpIcon aria-hidden />
            )}
            {pending ? "Uploading" : scan ? "Replace the scan" : "Add a scan"}
          </Button>
          {scan && (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-destructive hover:bg-destructive/5 hover:text-destructive sm:w-auto"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2Icon aria-hidden />
              Remove
            </Button>
          )}
        </div>
      )}
      {problem && <FormAlert>{problem}</FormAlert>}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove the scan?"
          description="The file is deleted. The record stays."
          confirmLabel="Remove the scan"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the scan"
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            const result = await removeComplianceScanAction(recordId);
            if (!result.ok) return result.error;
            setConfirmRemove(false);
          }}
        />
      )}
      <ActionErrorDialog
        error={error}
        title="We could not upload the scan"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
