import { productionHref } from "./labels";

/** A material picture as a small square (opens the full picture). */
export function MaterialThumb({ imageId, alt }: { imageId: string | null; alt: string }) {
  if (!imageId) return null;
  return (
    <a
      href={productionHref.file(imageId)}
      target="_blank"
      rel="noreferrer"
      className="shrink-0"
      aria-label={`Open the picture of ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- /api/files with its own checks */}
      <img
        src={productionHref.file(imageId)}
        alt=""
        className="size-12 rounded-md border bg-white object-contain"
      />
    </a>
  );
}
