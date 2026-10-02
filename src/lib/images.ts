import { inflateSync } from "node:zlib";

/*
 * Strict checks for images the PDF writer will draw (the company logo).
 *
 * pdfkit trusts what it is given: a PNG with a broken chunk length can send its
 * reader into an endless loop, and broken pixel data throws inside a zlib
 * callback, which would take the whole server down on every PDF. So a PNG must be
 * well formed down to its pixel rows before it is stored, and a JPG must be a
 * plain baseline or progressive one. A file that fails is simply refused.
 */

export type ImageInfo = {
  mimeType: "image/png" | "image/jpeg";
  ext: ".png" | ".jpg";
  width: number;
  height: number;
};

export type ImageLimits = { maxSide: number; maxPixels: number };

/** Plenty for a logo printed a few centimetres wide, and cheap to decode. */
export const LOGO_LIMITS: ImageLimits = { maxSide: 3000, maxPixels: 4_000_000 };

export class ImageCheckError extends Error {}

const fail = (reason: string): never => {
  throw new ImageCheckError(reason);
};

// --- PNG ----------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Allowed bit depths per colour type, and channels per pixel (PNG spec, IHDR). */
const COLOR_TYPES: Record<number, { depths: number[]; channels: number }> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 }, // greyscale
  2: { depths: [8, 16], channels: 3 }, // RGB
  3: { depths: [1, 2, 4, 8], channels: 1 }, // palette
  4: { depths: [8, 16], channels: 2 }, // greyscale + alpha
  6: { depths: [8, 16], channels: 4 }, // RGB + alpha
};

/** The seven Adam7 passes: start column / row and step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Each pass (one for a plain image) as rows of `rowBytes` bytes after a filter byte. */
function passes(width: number, height: number, bitsPerPixel: number, interlaced: boolean) {
  const shape = (w: number, h: number) => ({
    rows: h,
    rowBytes: Math.ceil((w * bitsPerPixel) / 8),
  });
  if (!interlaced) return [shape(width, height)];
  return ADAM7.map(([x0, y0, dx, dy]) =>
    shape(Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)),
  ).filter((p) => p.rows > 0 && p.rowBytes > 0);
}

/** Size and colour layout of a PNG, after checking every chunk and pixel row. */
export function inspectPng(bytes: Buffer, limits: ImageLimits) {
  if (bytes.length < 8 + 25 + 12 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("This is not a PNG image.");
  }
  let pos = 8;
  let header: {
    width: number;
    height: number;
    depth: number;
    colorType: number;
    interlaced: boolean;
  } | null = null;
  let paletteEntries = 0;
  let hasTransparency = false;
  let sawIdat = false;
  let idatEnded = false;
  const idat: Buffer[] = [];

  for (let index = 0; ; index++) {
    if (pos + 12 > bytes.length) fail("The PNG file is cut short.");
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (length > 0x7fffffff || pos + 12 + length > bytes.length) {
      fail("The PNG file is cut short.");
    }
    if (!/^[A-Za-z]{4}$/.test(type)) fail("The PNG file is damaged.");
    const body = bytes.subarray(pos + 8, pos + 8 + length);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== bytes.readUInt32BE(pos + 8 + length)) {
      fail("The PNG file is damaged.");
    }
    pos += 12 + length;

    if (index === 0 && type !== "IHDR") fail("The PNG file is damaged.");
    if (type !== "IDAT" && sawIdat) idatEnded = true;
    switch (type) {
      case "IHDR": {
        if (index !== 0 || length !== 13) fail("The PNG file is damaged.");
        header = {
          width: body.readUInt32BE(0),
          height: body.readUInt32BE(4),
          depth: body[8]!,
          colorType: body[9]!,
          interlaced: body[12] === 1,
        };
        const layout = COLOR_TYPES[header.colorType];
        if (!layout || !layout.depths.includes(header.depth)) {
          fail("This kind of PNG is not supported; save it again as a standard PNG.");
        }
        if (body[10] !== 0 || body[11] !== 0 || body[12]! > 1) {
          fail("This kind of PNG is not supported; save it again as a standard PNG.");
        }
        break;
      }
      case "PLTE":
        // One palette, before the picture data, and never on a greyscale image.
        if (length === 0 || length % 3 !== 0 || length > 768 || sawIdat || paletteEntries > 0) {
          fail("The PNG file is damaged.");
        }
        if (header!.colorType === 0 || header!.colorType === 4) fail("The PNG file is damaged.");
        paletteEntries = length / 3;
        break;
      case "tRNS": {
        const colorType = header!.colorType;
        const ok =
          !sawIdat &&
          ((colorType === 3 && length <= paletteEntries) ||
            (colorType === 0 && length === 2) ||
            (colorType === 2 && length === 6));
        if (!ok) fail("The PNG file is damaged.");
        hasTransparency = true;
        break;
      }
      case "IDAT":
        if (idatEnded) fail("The PNG file is damaged.");
        sawIdat = true;
        idat.push(body);
        break;
      case "IEND":
        if (length !== 0) fail("The PNG file is damaged.");
        break;
      default:
        // Ancillary chunks (lower-case first letter) can be skipped; critical ones cannot.
        if (type[0] === type[0]!.toUpperCase()) {
          fail("This kind of PNG is not supported; save it again as a standard PNG.");
        }
    }
    if (type === "IEND") break;
  }

  const { width, height, depth, colorType, interlaced } = header!;
  if (width < 1 || height < 1) fail("The image is empty.");
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
    fail(
      `The image is too large (${width} × ${height} pixels); use one up to ${limits.maxSide} pixels on each side.`,
    );
  }
  if (colorType === 3 && paletteEntries === 0) fail("The PNG file is damaged.");
  if (!sawIdat) fail("The PNG file has no picture data.");
  // pdfkit unpacks these pixel by pixel, which it gets wrong below 8 bits per channel.
  if (depth < 8 && (interlaced || hasTransparency)) {
    fail("This kind of PNG is not supported; save it again as a standard PNG.");
  }

  // Every pixel row must be there with a known filter, or decoding would fail later.
  const bitsPerPixel = depth * COLOR_TYPES[colorType]!.channels;
  const layout = passes(width, height, bitsPerPixel, interlaced);
  const expected = layout.reduce((sum, p) => sum + p.rows * (1 + p.rowBytes), 0);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch {
    return fail("The PNG picture data is damaged.");
  }
  if (pixels.length !== expected) fail("The PNG picture data is damaged.");
  let offset = 0;
  for (const pass of layout) {
    for (let row = 0; row < pass.rows; row++) {
      if (pixels[offset]! > 4) fail("The PNG picture data is damaged.");
      offset += 1 + pass.rowBytes;
    }
  }
  return { width, height };
}

// --- JPEG ---------------------------------------------------------------------

/** Baseline, extended and progressive JPEGs (what PDF viewers draw everywhere). */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
/** Frame types PDF readers do not draw reliably (lossless, hierarchical, arithmetic). */
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Size of a JPEG, read from its frame header. */
export function inspectJpeg(bytes: Buffer, limits: ImageLimits) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("This is not a JPG image.");
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) fail("The JPG file is damaged.");
    const marker = bytes[pos + 1]!;
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan before a frame
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const length = bytes.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) fail("The JPG file is cut short.");
    if (OTHER_FRAMES.has(marker)) {
      fail("This kind of JPG is not supported; save it again as a standard JPG.");
    }
    if (JPEG_FRAMES.has(marker)) {
      if (length < 8) fail("The JPG file is damaged.");
      const height = bytes.readUInt16BE(pos + 5);
      const width = bytes.readUInt16BE(pos + 7);
      const components = bytes[pos + 9]!;
      if (bytes[pos + 4] !== 8 || ![1, 3, 4].includes(components)) {
        fail("This kind of JPG is not supported; save it again as a standard JPG.");
      }
      if (length < 8 + 3 * components) fail("The JPG file is damaged.");
      if (width < 1 || height < 1) fail("The image is empty.");
      if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
        fail(
          `The image is too large (${width} × ${height} pixels); use one up to ${limits.maxSide} pixels on each side.`,
        );
      }
      return { width, height };
    }
    pos += 2 + length;
  }
  return fail("The JPG file is damaged.");
}

/** A PNG or JPG the PDF writer can draw safely, with its size; anything else is refused. */
export function inspectImage(bytes: Buffer, limits: ImageLimits): ImageInfo {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mimeType: "image/png", ext: ".png", ...inspectPng(bytes, limits) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { mimeType: "image/jpeg", ext: ".jpg", ...inspectJpeg(bytes, limits) };
  }
  return fail("Use a PNG or JPG image.");
}
