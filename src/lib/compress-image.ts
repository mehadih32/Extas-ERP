/*
 * Makes a photo small in the browser before it is uploaded, so the server only
 * ever keeps small proof files (a phone photo of a cheque is often 3-5 MB; it
 * leaves here at about 100 KB) and small quotation pictures (PICTURE_OPTIONS:
 * about 150 KB, always a JPG because the PDF writer draws them). The photo is redrawn at most PROOF_MAX_SIDE
 * pixels on its long side and saved as WebP, or as JPG where the browser cannot
 * make WebP; quality and then size step down until it fits. Redrawing also drops
 * the photo's hidden details (camera, place). The tries are a pure plan
 * (`attempts`, `shrinkWith`) so they can be tested without a browser.
 */

/** What a proof photo aims at. */
export const PROOF_TARGET_BYTES = 100 * 1024;
/** Long side in pixels: a cheque or a screenshot stays readable. */
export const PROOF_MAX_SIDE = 1600;
/** Never smaller than this on the long side, even if the file stays a little over the aim. */
const MIN_SIDE = 480;
const QUALITIES = [0.82, 0.72, 0.62, 0.52];

export type Attempt = { width: number; height: number; quality: number };

/** The sizes and qualities to try, best first. */
export function attempts(width: number, height: number, maxSide = PROOF_MAX_SIDE): Attempt[] {
  const long = Math.max(width, height, 1);
  let scale = Math.min(1, maxSide / long);
  const tries: Attempt[] = [];
  for (let round = 0; round < 8; round++) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    for (const quality of QUALITIES) tries.push({ width: w, height: h, quality });
    if (Math.max(w, h) <= MIN_SIDE) break;
    scale = Math.max(scale * 0.75, MIN_SIDE / long);
  }
  return tries;
}

/** Encodes with each try until one fits `target` bytes; else the smallest made. */
export async function shrinkWith(
  encode: (attempt: Attempt) => Promise<Blob>,
  width: number,
  height: number,
  target = PROOF_TARGET_BYTES,
  maxSide = PROOF_MAX_SIDE,
): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const attempt of attempts(width, height, maxSide)) {
    const blob = await encode(attempt);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= target) return blob;
  }
  if (!smallest) throw new Error("The photo could not be made smaller.");
  return smallest;
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  done: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        done: () => bitmap.close(),
      };
    } catch {
      // Older browsers: read it through an <img> below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      done: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be saved."))),
      type,
      quality,
    ),
  );

/** What a quotation item's reference picture aims at: printed on PDFs, so always a JPG. */
export const PICTURE_OPTIONS = { target: 150 * 1024, maxSide: 1400, jpegOnly: true } as const;

/**
 * A smaller copy of a photo, ready to upload (WebP, or JPG; always JPG with
 * `jpegOnly`, for pictures the PDF writer draws). Throws when the file is not a
 * photo the browser can read.
 */
export async function compressImage(
  file: File,
  target: number = PROOF_TARGET_BYTES,
  options: { maxSide?: number; jpegOnly?: boolean } = {},
): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPG, PNG or WebP).");
  const image = await loadImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot make photos smaller.");
    canvas.width = 1;
    canvas.height = 1;
    const webp = !options.jpegOnly && canvas.toDataURL("image/webp").startsWith("data:image/webp");
    const type = webp ? "image/webp" : "image/jpeg";
    const blob = await shrinkWith(
      async ({ width, height, quality }) => {
        canvas.width = width;
        canvas.height = height;
        // A white page under see-through parts (JPG has no transparency).
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image.source, 0, 0, width, height);
        return toBlob(canvas, type, quality);
      },
      image.width,
      image.height,
      target,
      options.maxSide ?? PROOF_MAX_SIDE,
    );
    const base = file.name.replace(/\.[^.]*$/, "") || "proof";
    return new File([blob], `${base}${webp ? ".webp" : ".jpg"}`, { type });
  } finally {
    image.done();
  }
}

/** "96 KB", "2.4 MB": a file size as people read it. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
