# Caddy with Cloudflare's DNS module (README.md, "HTTPS behind Cloudflare"):
# certificates through Cloudflare's DNS check, which works with Cloudflare's
# proxy on and needs no open port 80. deploy.sh builds it only while a
# Cloudflare token is in deploy/.env; otherwise plain caddy:2-alpine runs.
# Exact versions only, so every build is the same Caddy and the same module:
# Caddy 2.11.7 (its builder and runtime images on Docker Hub) and
# github.com/caddy-dns/cloudflare v0.2.4 (from Go's module proxy), both checked
# on 2026-10-16. To move to newer ones, change these two lines; deploy.sh then
# builds again at its next run.
ARG CADDY_VERSION=2.11.7
ARG CLOUDFLARE_MODULE=v0.2.4

FROM caddy:${CADDY_VERSION}-builder-alpine AS build
ARG CADDY_VERSION
ARG CLOUDFLARE_MODULE
RUN xcaddy build "v${CADDY_VERSION}" --with "github.com/caddy-dns/cloudflare@${CLOUDFLARE_MODULE}"

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
