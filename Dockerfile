# syntax=docker/dockerfile:1

# Extas ERP server image (used by deploy/compose.yml; see deploy/README.md).
#   runner  the app: the Next.js standalone server, plus the PostgreSQL 16 client
#           tools the daily backups run (pg_dump)
#   tools   the whole project with its build tools, for database migrations and
#           creating the first owner account
# Both are built on Ubuntu 24.04 LTS (security updates until 2029), whose own
# archive carries PostgreSQL 16's client tools. Node.js comes from its official
# image.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS node

# --- The operating system, Node.js and the PostgreSQL 16 client tools ----------
FROM ubuntu:24.04 AS os
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# --- npm, for installing and building ------------------------------------------
FROM os AS sdk
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1
WORKDIR /app

# --- Dependencies (the Prisma client is generated on install) -------------------
FROM sdk AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# The download cache stays on the server between builds.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --fetch-retries=5

# --- The production build --------------------------------------------------------
FROM deps AS builder
COPY . .
RUN npm run build
# Bug Guard's "Packages with known weaknesses" check reads npm's own report on the
# packages the app runs with. No answer from npm (offline) leaves an empty report.
RUN (timeout 120 npm audit --omit=dev --json > npm-audit.json || true); \
    test -s npm-audit.json || echo '{}' > npm-audit.json
# Bug Guard's "Help pictures out of date" check reads the guides whose picture is
# older than their screen or steps (v6.4 L1; scripts/help/list-old-pictures.ts).
# A list that cannot be made leaves an empty one: the build never stops for it.
RUN (timeout 300 npx tsx scripts/help/list-old-pictures.ts help-pictures-old.json || true); \
    test -s help-pictures-old.json || echo '{}' > help-pictures-old.json

# --- Migrations and the first-run seed -------------------------------------------
FROM deps AS tools
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

# --- The app ----------------------------------------------------------------------
FROM os AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    PG_DUMP_PATH=/usr/lib/postgresql/16/bin/pg_dump
# Runs as an unprivileged user (uid 1001); deploy.sh gives it the upload and backup folders.
RUN groupadd --system --gid 1001 erp \
 && useradd --system --uid 1001 --gid erp --home-dir /app --shell /usr/sbin/nologin erp \
 && mkdir -p /data/uploads /data/backups \
 && chown -R erp:erp /data
COPY --from=builder --chown=erp:erp /app/.next/standalone ./
COPY --from=builder --chown=erp:erp /app/.next/static ./.next/static
# The standalone build leaves out public/: the favicon, the app icons, the service
# worker and its offline page are served from here.
COPY --from=builder --chown=erp:erp /app/public ./public
COPY --from=builder --chown=erp:erp /app/npm-audit.json ./npm-audit.json
COPY --from=builder --chown=erp:erp /app/help-pictures-old.json ./help-pictures-old.json
USER erp
EXPOSE 3000
CMD ["node", "server.js"]
