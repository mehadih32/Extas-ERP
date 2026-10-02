// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle for the Docker image on the Azure VPS.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's query engine must stay outside the server bundle, and so does the PDF
  // writer (it loads its fonts and colour profile from its own package at run time).
  serverExternalPackages: ["@prisma/client", ".prisma/client", "pdfkit"],
  experimental: {
    serverActions: {
      // Allows packing-list photos / PDFs for AI stock intake.
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
