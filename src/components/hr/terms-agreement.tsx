"use client";

import { ArrowDownIcon, LoaderCircleIcon, MessageSquareIcon, PenLineIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { TermsGate } from "@/modules/hr/terms.service";
import { agreeToTermsAction, sendTermsCodeAction } from "@/server/actions/terms.actions";

import { SignaturePad } from "./signature-pad";
import { TermsText } from "./terms-text";

type Method = "SIGNATURE" | "SMS_CODE";

/**
 * The terms screen for someone who must agree: the whole text, then the
 * agreement. Signing opens only once they have scrolled to the end of the text;
 * a bar at the bottom says so until then. They sign in the box, or (when SMS is
 * connected and a mobile number is on file) agree with a code sent by SMS.
 */
export function TermsAgreement({ gate, next }: { gate: TermsGate; next: string }) {
  const v = gate.version;
  const endRef = useRef<HTMLDivElement>(null);
  const [reached, setReached] = useState(false);
  const [method, setMethod] = useState<Method>("SIGNATURE");
  const [signature, setSignature] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ sentTo: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<ActionError>();
  const [problem, setProblem] = useState<{ signature?: string; code?: string }>({});
  const [pending, startTransition] = useTransition();
  const [sending, startSending] = useTransition();

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setReached(true);
        watch.disconnect();
      }
    });
    watch.observe(end);
    return () => watch.disconnect();
  }, []);

  // The countdown before another code can be asked for.
  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);
  const wait = sent ? Math.max(0, gate.code.resendSeconds - Math.floor((now - sent.at) / 1000)) : 0;

  function sendCode() {
    setError(undefined);
    setProblem({});
    startSending(async () => {
      const result = await sendTermsCodeAction();
      if (!result.ok) return setError(result.error);
      setSent({ sentTo: result.data.sentTo, at: Date.now() });
      setNow(Date.now());
    });
  }

  function agree() {
    const found: typeof problem = {};
    if (method === "SIGNATURE" && !signature) found.signature = "Sign in the box first.";
    if (method === "SMS_CODE" && !/^\d{6}$/.test(code.trim())) {
      found.code = "Enter the 6-digit code from the SMS.";
    }
    setProblem(found);
    setError(undefined);
    if (Object.keys(found).length > 0) return;
    startTransition(async () => {
      const result = await agreeToTermsAction(
        method === "SIGNATURE"
          ? { versionId: v.id, method, signature }
          : { versionId: v.id, method, code: code.trim() },
      );
      if (!result.ok) {
        const fields = result.error.fieldErrors ?? {};
        if (fields.signature?.[0] || fields.code?.[0]) {
          return setProblem({ signature: fields.signature?.[0], code: fields.code?.[0] });
        }
        return setError(result.error);
      }
      // A full load, so the app opens with everything the terms held back.
      window.location.assign(next);
    });
  }

  return (
    <div className="grid gap-8 pb-24">
      <header>
        <p className="eyebrow">Before you start</p>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
          Terms of employment
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Version {v.version}
          {v.publishedOn ? `, published ${formatDay(v.publishedOn)}` : ""}. Please read them to the
          end. You can agree once you reach the bottom.
        </p>
        {gate.lastAgreed && (
          <div className="mt-4">
            <FormAlert tone="note">
              The terms changed since you agreed to version {gate.lastAgreed.version} on{" "}
              {formatDay(gate.lastAgreed.signedOn)}. Please read this version and agree again.
            </FormAlert>
          </div>
        )}
      </header>

      <TermsText text={v} className="rounded-lg border bg-card p-5 sm:p-8" />
      <div ref={endRef} aria-hidden className="h-px" />

      <section
        aria-labelledby="agree-heading"
        className="grid gap-5 rounded-lg border bg-card p-5 sm:p-8"
      >
        <div>
          <h2 id="agree-heading" className="font-serif text-xl text-primary">
            Agree to the terms
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed">
            I, <span className="font-medium">{gate.employee?.name}</span>
            {gate.employee ? ` (${gate.employee.code})` : ""}, have read these terms to the end and
            agree to them.
          </p>
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            A signed copy is kept in your papers (My HR, My details), with the time, your IP address
            and your device.
          </p>
        </div>

        {gate.code.available && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">How I agree</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["SIGNATURE", "Sign by hand", PenLineIcon],
                  ["SMS_CODE", `Code by SMS to ${gate.code.phone}`, MessageSquareIcon],
                ] as const
              ).map(([value, label, Icon]) => (
                <label
                  key={value}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                    method === value ? "border-primary bg-secondary" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => {
                      setMethod(value);
                      setProblem({});
                    }}
                    className="size-4 accent-primary"
                  />
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {method === "SIGNATURE" ? (
          <div className="grid gap-2">
            <p id="signature-label" className="text-sm font-medium">
              My signature
            </p>
            <SignaturePad
              label="Signature box"
              disabled={!reached}
              invalid={Boolean(problem.signature)}
              describedBy={problem.signature ? "signature-error" : "signature-label"}
              onChange={(png) => {
                setSignature(png);
                if (png) setProblem({});
              }}
            />
            {problem.signature && (
              <p id="signature-error" className="text-[0.8125rem] text-destructive">
                {problem.signature}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={sendCode}
                disabled={!reached || sending || wait > 0}
              >
                {sending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                {sent ? "Send another code" : "Send me a code"}
              </Button>
              {sent && (
                <p className="text-[0.8125rem] text-muted-foreground" role="status">
                  Sent to {sent.sentTo}. It works for {gate.code.minutes} minutes
                  {wait > 0 ? `; another in ${wait} s` : ""}.
                </p>
              )}
            </div>
            <Field id="terms-code" label="Code from the SMS" error={problem.code}>
              <Input
                id="terms-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (problem.code) setProblem({});
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="sm:w-48"
                disabled={!reached || !sent}
                aria-invalid={Boolean(problem.code)}
                aria-describedby={problem.code ? "terms-code-error" : undefined}
              />
            </Field>
          </div>
        )}

        {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={agree}
            disabled={!reached || pending}
          >
            {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            {pending ? "Saving" : "I agree"}
          </Button>
          {!reached && (
            <p className="text-[0.8125rem] text-muted-foreground">
              Read to the end of the terms to agree.
            </p>
          )}
        </div>
        <div className="border-t pt-4 text-center sm:text-left">
          <SignOutButton variant="link" size="sm" className="h-auto p-0 text-muted-foreground">
            Not you? Sign out
          </SignOutButton>
        </div>
      </section>

      {!reached && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-sm">Read to the end to agree.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" })}
            >
              <ArrowDownIcon aria-hidden />
              Keep reading
            </Button>
          </div>
        </div>
      )}

      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save your agreement"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}
