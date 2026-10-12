"use client";

import { DownloadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { inAndroidApp } from "@/components/hr/location-client";
import { Button } from "@/components/ui/button";

const DISMISSED = "extas:install-dismissed";
/** After "Not now", ask again after this long. */
const ASK_AGAIN_MS = 30 * 24 * 60 * 60 * 1000;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

function dismissedLately() {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED));
    return Number.isFinite(at) && Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(DISMISSED, String(Date.now()));
  } catch {
    // Private browsing: it asks again next time.
  }
}

/** Already opened from the home screen, or not a phone or tablet. */
function nothingToInstall() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || inAndroidApp() || !window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Makes Extas ERP installable (the service worker in public/sw.js) and, on a
 * phone, offers to put it on the home screen once: "Install" where the browser
 * can do it (Chrome on Android), or how to do it on an iPhone. "Not now" asks
 * again after a month; never inside the Android app.
 */
export function InstallApp() {
  const [offer, setOffer] = useState<"prompt" | "ios" | null>(null);
  const prompt = useRef<InstallPrompt | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    if (nothingToInstall() || dismissedLately()) return;
    const ready = (event: Event) => {
      event.preventDefault();
      prompt.current = event as InstallPrompt;
      setOffer("prompt");
    };
    window.addEventListener("beforeinstallprompt", ready);
    // iPhones have no install prompt: explain the Share button after a moment.
    const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const timer = iPhone ? window.setTimeout(() => setOffer("ios"), 4000) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.clearTimeout(timer);
    };
  }, []);

  if (!offer) return null;

  const close = () => {
    remember();
    setOffer(null);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="install-heading"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 grid gap-3 rounded-lg border bg-card p-4 shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-96 print:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p id="install-heading" className="text-sm font-medium">
            {offer === "ios" ? "Add Extas ERP to your home screen" : "Install Extas ERP"}
          </p>
          <p className="text-[0.8125rem] text-muted-foreground">
            {offer === "ios"
              ? "Tap the Share button, then Add to Home Screen. It opens full screen like an app."
              : "Open it from your home screen like an app, full screen."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 shrink-0"
          onClick={close}
          aria-label="Not now"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      {offer === "prompt" && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const event = prompt.current;
              setOffer(null);
              if (!event) return;
              await event.prompt();
              await event.userChoice.catch(() => undefined);
              prompt.current = null;
            }}
          >
            <DownloadIcon aria-hidden />
            Install
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={close}>
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}
