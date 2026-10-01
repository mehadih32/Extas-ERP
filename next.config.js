// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle for the Docker image on the Azure VPS.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's query engine must stay outside the server bundle.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  experimental: {
    serverActions: {
      // Allows packing-list photos / PDFs for AI stock intake.
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
