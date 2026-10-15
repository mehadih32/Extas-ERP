// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle for the Docker image on the Azure VPS.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
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
  ],
  // The Bengali font and Mehedi 2.0's books are read from assets at run time, so
  // the build copies them in.
  outputFileTracingIncludes: {
    "/*": [
      "./assets/fonts/*.ttf",
      "./assets/knowledge/*",
      "./node_modules/harfbuzzjs/dist/harfbuzz.wasm",
    ],
  },
  experimental: {
    serverActions: {
      // Allows packing-list photos / PDFs for AI stock intake.
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
