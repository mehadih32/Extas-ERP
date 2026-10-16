# Caddy with Cloudflare's DNS module (README.md, "HTTPS behind Cloudflare"):
# certificates through Cloudflare's DNS check, which works with Cloudflare's
# proxy on and needs no open port 80. deploy.sh builds it only while a
# Cloudflare token is in deploy/.env; otherwise plain caddy:2-alpine runs.
FROM caddy:2-builder-alpine AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
