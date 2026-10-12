"use client";

import {
  ChevronDownIcon,
  FileDownIcon,
  LoaderCircleIcon,
  MailIcon,
  MessageCircleIcon,
  Share2Icon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { toast } from "@/components/feedback/toaster";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { whatsappHref } from "./contact-links";
import { hrHref } from "./labels";

/** "Extras - 360 report EMP-0103 Rahim Uddin.pdf" from the download's header. */
function fileNameOf(response: Response, fallback: string) {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  try {
    return encoded ? decodeURIComponent(encoded) : fallback;
  } catch {
    return fallback;
  }
}

/** Makes the employee's 360° report on the server and hands back the PDF. */
export async function fetchReport(employeeId: string): Promise<File> {
  const response = await fetch(hrHref.report(employeeId));
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "The report could not be made. Try again.");
  }
  const blob = await response.blob();
  return new File([blob], fileNameOf(response, "360 report.pdf"), { type: "application/pdf" });
}

/** Saves the PDF on the device (the browser's own download). */
export function saveReport(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Downloads one employee's report, saying so when it cannot be made. */
export async function downloadReport(employeeId: string, name: string) {
  try {
    saveReport(await fetchReport(employeeId));
    toast.success(`${name}'s 360° report is downloaded.`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The report could not be made.");
  }
}

// Whether this browser shares files with other apps (phones, and some computers).
let filesShareable: boolean | null = null;
function canShareFiles() {
  if (filesShareable === null) {
    try {
      filesShareable =
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [new File([""], "report.pdf", { type: "application/pdf" })] });
    } catch {
      filesShareable = false;
    }
  }
  return filesShareable;
}
const noChanges = () => () => undefined;

type Busy = "download" | "share" | "whatsapp" | "email" | null;

/**
 * The 360° report on an employee's profile: download it, or send it on in one
 * tap. On a phone (or a browser that shares files) the PDF goes straight to
 * WhatsApp, email or any app; otherwise the PDF is saved and a WhatsApp chat
 * or an email to the employee opens with a note, ready for the PDF to be
 * attached.
 */
export function ReportActions({
  employee,
  company,
}: {
  employee: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
  };
  company: string;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const shareable = useSyncExternalStore(noChanges, canShareFiles, () => false);
  const chat = whatsappHref(employee.whatsapp, employee.phone);
  const firstName = employee.name.split(/\s+/)[0] ?? employee.name;
  const note = `Hello ${firstName}, here is your 360° report from ${company} for the last 12 months.`;

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>) {
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      // Closing the share sheet without choosing is not a problem.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "The report could not be made.");
      }
    } finally {
      setBusy(null);
    }
  }

  const download = () =>
    run("download", async () => {
      saveReport(await fetchReport(employee.id));
      toast.success(`${employee.name}'s 360° report is downloaded.`);
    });

  const share = () =>
    run("share", async () => {
      const file = await fetchReport(employee.id);
      await navigator.share({ files: [file], title: `${employee.name}: 360° report`, text: note });
    });

  const whatsapp = () => {
    // Opened at the tap itself, so the browser does not block it as a pop-up.
    const chatWindow = window.open("about:blank", "_blank");
    return run("whatsapp", async () => {
      try {
        saveReport(await fetchReport(employee.id));
      } catch (error) {
        chatWindow?.close();
        throw error;
      }
      const href = `${chat}?text=${encodeURIComponent(`${note} The PDF is attached.`)}`;
      if (chatWindow) chatWindow.location.href = href;
      else window.open(href, "_self");
      toast.success("The PDF is downloaded. Attach it in the WhatsApp chat.");
    });
  };

  const email = () =>
    run("email", async () => {
      saveReport(await fetchReport(employee.id));
      const subject = `Your 360° report from ${company}`;
      window.location.href = `mailto:${encodeURIComponent(employee.email!)}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(`${note}\n\nThe PDF is attached.`)}`;
      toast.success("The PDF is downloaded. Attach it to the email.");
    });

  const sending = busy !== null && busy !== "download";
  const offers = shareable || chat || employee.email;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      <Button type="button" onClick={download} disabled={busy !== null} className="w-full">
        {busy === "download" ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <FileDownIcon aria-hidden />
        )}
        {busy === "download" ? "Making the report" : "Download 360° report"}
      </Button>
      {offers && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" disabled={busy !== null} className="w-full">
              {sending ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden />
              ) : (
                <Share2Icon aria-hidden />
              )}
              {sending ? "Getting it ready" : "Share the report"}
              <ChevronDownIcon className="ml-auto" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {shareable && (
              <DropdownMenuItem onSelect={share}>
                <Share2Icon aria-hidden />
                Send the PDF to an app
              </DropdownMenuItem>
            )}
            {chat && (
              <DropdownMenuItem onSelect={whatsapp}>
                <MessageCircleIcon aria-hidden />
                WhatsApp {firstName}
              </DropdownMenuItem>
            )}
            {employee.email && (
              <DropdownMenuItem onSelect={email}>
                <MailIcon aria-hidden />
                Email {firstName}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
