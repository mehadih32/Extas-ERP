// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle for the Docker image on the Azure VPS.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // The server's own build (Dockerfile) skips the type check: every commit it builds
  // passed it on GitHub first ("Tests and build"), and it is the build's largest use of
  // memory, which an 8 GB server (B2ms) does not have to spare.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
  // Prisma's query engine must stay outside the server bundle, and so do the PDF
  // writer (it loads its fonts and colour profile from its own package at run time)
  // and HarfBuzz, which shapes Bengali text and loads its WebAssembly file the same way.
  // The mailer is kept outside too: it loads its transports from its own package.
  serverExternalPackages: [
    "@prisma/client",
    ".prisma/client",
    "pdfkit",
    "harfbuzzjs",
    "nodemailer",
    // "Upload packing list" reads photos with the OCR engine and PDFs with PDF.js on the
    // server: both load their own WebAssembly, worker and language files at run time.
    "tesseract.js",
    "tesseract.js-core",
    "unpdf",
  ],
  // The Bengali font and Mehedi 2.0's books are read from assets at run time, so
  // the build copies them in.
  outputFileTracingIncludes: {
    "/*": [
      "./assets/fonts/*.ttf",
      "./assets/knowledge/*",
      "./node_modules/harfbuzzjs/dist/harfbuzz.wasm",
      // The OCR engine runs in a worker thread it starts by file path, and reads the
      // English data from the app's own packages (never from the internet).
      "./node_modules/tesseract.js/{package.json,src/**/*}",
      // Only the LSTM engine is used (OEM 1); tesseract.js picks one of these three by what
      // the server's CPU supports, and each loader reads its .wasm beside it.
      "./node_modules/tesseract.js-core/{index.js,package.json}",
      "./node_modules/tesseract.js-core/tesseract-core-{lstm,simd-lstm,relaxedsimd-lstm}.{js,wasm}",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
      "./node_modules/{bmp-js,is-url,node-fetch,regenerator-runtime,wasm-feature-detect,zlibjs,whatwg-url,tr46,webidl-conversions}/**/*",
      "./node_modules/unpdf/dist/**/*",
    ],
  },
  // Retail stores, Returns and Shop stock moved inside Business > Retail (2026-10-31):
  // old links and bookmarks still open them.
  async redirects() {
    return ["stores", "returns", "shop-stock"].map((page) => ({
      source: `/business/${page}/:rest*`,
      destination: `/business/retail/${page}/:rest*`,
      permanent: true,
    }));
  },
  experimental: {
    serverActions: {
      // Allows packing-list photos, PDFs and Excel files (stock intake, Upload packing list).
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
