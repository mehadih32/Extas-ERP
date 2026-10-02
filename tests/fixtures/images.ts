import { crc32, deflateSync } from "node:zlib";

/*
 * Small PNG and JPEG files built byte by byte, valid or broken on purpose, for
 * the logo checks and the letterhead PDFs.
 */

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** A PNG chunk with its length and CRC (or the CRC given). */
export function chunk(type: string, body: Buffer = Buffer.alloc(0), crc?: number): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc ?? crc32(Buffer.concat([Buffer.from(type, "latin1"), body])));
  return Buffer.concat([head, body, tail]);
}

/** Pixel rows, each after filter byte `filter`, pass by pass when interlaced. */
export function scanlines(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlaced: boolean,
  filter = 0,
): Buffer {
  const shapes = interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => [Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)])
    : [[width, height]];
  const parts: Buffer[] = [];
  for (const [w, h] of shapes) {
    if (w! <= 0 || h! <= 0) continue;
    const rowBytes = Math.ceil((w! * bitsPerPixel) / 8);
    for (let r = 0; r < h!; r++) {
      parts.push(Buffer.from([filter]), Buffer.alloc(rowBytes, (r * 37) & 0xff));
    }
  }
  return Buffer.concat(parts);
}

export type PngOptions = {
  width: number;
  height: number;
  depth?: number;
  colorType?: number;
  interlace?: number;
  /** Chunks between IHDR and IDAT (PLTE, tRNS, tEXt...). */
  before?: Buffer[];
  /** Raw (uncompressed) pixel data instead of valid rows. */
  raw?: Buffer;
  /** The IDAT chunks themselves. */
  idat?: Buffer[];
};

/** A PNG (8-bit RGBA unless told otherwise). */
export function png(o: PngOptions): Buffer {
  const depth = o.depth ?? 8;
  const colorType = o.colorType ?? 6;
  const interlace = o.interlace ?? 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(o.width, 0);
  ihdr.writeUInt32BE(o.height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const raw =
    o.raw ?? scanlines(o.width, o.height, depth * (CHANNELS[colorType] ?? 1), interlace === 1);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    ...(o.before ?? []),
    ...(o.idat ?? [chunk("IDAT", deflateSync(raw))]),
    chunk("IEND"),
  ]);
}

/** A palette of `entries` colours. */
export const palette = (entries: number) => chunk("PLTE", Buffer.alloc(entries * 3, 0x40));

export type JpegOptions = {
  width: number;
  height: number;
  marker?: number;
  precision?: number;
  components?: number;
  /** Segment length written in the frame header. */
  length?: number;
  /** Bytes between the JFIF header and the frame. */
  before?: Buffer;
};

/** A JPEG's headers: JFIF segment, frame, scan header and end (no real picture data). */
export function jpeg(o: JpegOptions): Buffer {
  const components = o.components ?? 3;
  const sof = Buffer.alloc(10 + 3 * components);
  sof[0] = 0xff;
  sof[1] = o.marker ?? 0xc0;
  sof.writeUInt16BE(o.length ?? 8 + 3 * components, 2);
  sof[4] = o.precision ?? 8;
  sof.writeUInt16BE(o.height, 5);
  sof.writeUInt16BE(o.width, 7);
  sof[9] = components;
  for (let i = 0; i < components; i++) sof.set([i + 1, 0x11, 0], 10 + i * 3);
  const jfif = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jfif,
    o.before ?? Buffer.alloc(0),
    sof,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9]),
  ]);
}
