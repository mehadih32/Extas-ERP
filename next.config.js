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
  serverExternalPackages: ["@prisma/client", ".prisma/client", "pdfkit", "harfbuzzjs"],
  // The Bengali font is read from assets/fonts at run time, so the build copies it in.
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/*.ttf", "./node_modules/harfbuzzjs/dist/harfbuzz.wasm"],
  },
  experimental: {
    serverActions: {
      // Allows packing-list photos / PDFs for AI stock intake.
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
