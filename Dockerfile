# The healer is not a plain Next.js app: a heal shells out to git, writes the patched file to
# a temp checkout, and launches a real browser to prove a candidate matches exactly one
# element. So the image carries git and Chromium, and the app must run somewhere with a
# writable filesystem — a container, not a serverless function.

# ---- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Chromium is installed in the runner from apt, so skip any browser download here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# supabase.ts throws at import time without these, and `next build` imports it while
# collecting page data. Passed per-command rather than as ENV so no placeholder credential is
# baked into an image layer; the real values are injected at runtime.
# --webpack, not Turbopack: Turbopack ships no native bindings for linux/arm64 and the build
# dies there. Webpack builds on both architectures, which is what lets this image run on the
# free ARM tiers (Oracle Ampere, AWS Graviton) as well as on amd64.
RUN SUPABASE_URL=https://placeholder.invalid \
    SUPABASE_SECRET_KEY=unused-at-build-time \
    npx next build --webpack

# ---- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# git: shallow-clones the failing commit.  chromium: the XPath gate.
# ca-certificates: HTTPS to GitHub, Supabase and the model provider.
RUN apt-get update \
 && apt-get install --no-install-recommends -y git chromium ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The gate defaults to `channel: "chrome"`, which looks for Google Chrome specifically.
# Debian ships Chromium, so point at it explicitly — executablePath takes precedence.
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root. The heal writes only to a per-run mkdtemp under /tmp, never into /app.
RUN useradd --system --create-home --uid 1001 healer
USER healer

COPY --from=build --chown=healer:healer /app/.next/standalone ./
COPY --from=build --chown=healer:healer /app/.next/static ./.next/static
COPY --from=build --chown=healer:healer /app/public ./public

# Fly and Railway both inject PORT; default to it and fall back for a bare `docker run`.
ENV PORT=3002
EXPOSE 3002
CMD ["node", "server.js"]
