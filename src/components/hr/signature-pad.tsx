"use client";

import { EraserIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/** A signature shorter than this (in screen pixels of ink) is a tap, not a signature. */
const MIN_INK = 60;

/**
 * A box to sign in with a finger, a pen or the mouse. Hands the signature up as
 * a PNG (data URL) once there is enough ink, and null when cleared. The page
 * does not scroll while signing in the box.
 */
export function SignaturePad({
  label,
  disabled = false,
  invalid = false,
  describedBy,
  onChange,
}: {
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (png: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Sharp on phones: the drawing surface follows the screen's pixel density.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const pen = canvas.getContext("2d");
    if (!pen) return;
    pen.lineWidth = 2.4 * ratio;
    pen.lineCap = "round";
    pen.lineJoin = "round";
    pen.strokeStyle = "#111827";
    pen.fillStyle = "#111827";
  }, []);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * canvas.width) / box.width,
      y: ((event.clientY - box.top) * canvas.height) / box.height,
      scale: canvas.width / box.width,
    };
  };

  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = pointOf(event);
    last.current = p;
    const pen = event.currentTarget.getContext("2d");
    pen?.beginPath();
    pen?.arc(p.x, p.y, (pen.lineWidth || 2) / 2, 0, Math.PI * 2);
    pen?.fill();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current || disabled) return;
    event.preventDefault();
    const p = pointOf(event);
    const pen = event.currentTarget.getContext("2d");
    if (!pen) return;
    pen.beginPath();
    pen.moveTo(last.current.x, last.current.y);
    pen.lineTo(p.x, p.y);
    pen.stroke();
    ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y) / p.scale;
    last.current = p;
  }

  function up(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return;
    last.current = null;
    if (ink.current >= MIN_INK) {
      setEmpty(false);
      onChange(event.currentTarget.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    ink.current = 0;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="grid gap-2">
      <div
        className={`relative overflow-hidden rounded-md border bg-white ${
          invalid ? "border-destructive" : "border-input"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          aria-describedby={describedBy}
          className={`block h-44 w-full touch-none ${disabled ? "cursor-not-allowed" : "cursor-crosshair"}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-6 bottom-9 left-6 border-b border-dashed border-gray-300"
        />
        {empty && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[0.8125rem] text-gray-500"
          >
            {disabled ? "Read to the end to sign" : "Sign above the line with your finger"}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-self-start"
        onClick={clear}
        disabled={disabled || empty}
      >
        <EraserIcon aria-hidden />
        Clear the signature
      </Button>
    </div>
  );
}
