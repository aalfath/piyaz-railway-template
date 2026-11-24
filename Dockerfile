# Piyaz v0.4.18 for Railway, built from the pinned upstream release.
# Upstream publishes no container image, so we build the tagged source here.
ARG BUN_IMAGE=oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18

FROM ${BUN_IMAGE} AS src
ARG PIYAZ_VERSION=0.4.18
ARG PIYAZ_COMMIT=e1ed033e9a4d0e7af81da5833b47dcd2c0e6fdfb
ARG PIYAZ_SHA256=47d23c154176ae498d564b86317c294c7ae3084154a79ead110207eb903f5958
WORKDIR /src
ADD https://codeload.github.com/FrkAk/piyaz/tar.gz/${PIYAZ_COMMIT} /tmp/piyaz.tar.gz
RUN echo "${PIYAZ_SHA256}  /tmp/piyaz.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/piyaz.tar.gz --strip-components=1 -C /src \
 && rm /tmp/piyaz.tar.gz
# Self-host additions: invite-only sign-up gate (see selfhost/README in this repo).
COPY selfhost/signup-gate.ts /src/lib/selfhost/signup-gate.ts
COPY selfhost/apply-patches.ts /tmp/apply-patches.ts
RUN bun /tmp/apply-patches.ts /src

FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY --from=src /src/package.json /src/bun.lock /src/bunfig.toml ./
COPY --from=src /src/patches ./patches
RUN bun install --frozen-lockfile
COPY --from=src /src ./
ENV NEXT_TELEMETRY_DISABLED=1 \
    CIRCLE_NODE_TOTAL=2 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN bun run build
# One-shot bootstrap (roles, schema, migrations, RLS, owner account), bundled
# so the runtime image needs nothing outside .next/standalone.
COPY selfhost/bootstrap.ts /app/selfhost/bootstrap.ts
RUN bun build /app/selfhost/bootstrap.ts --target=bun --outfile=/out/bootstrap.js

FROM ${BUN_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /out/bootstrap.js /opt/piyaz/bootstrap.js
COPY --from=src /src/drizzle /opt/piyaz/drizzle
COPY --from=src /src/docker /opt/piyaz/sql
COPY selfhost/start.sh /opt/piyaz/start.sh
RUN chmod 755 /opt/piyaz/start.sh
EXPOSE 3000
CMD ["/opt/piyaz/start.sh"]
