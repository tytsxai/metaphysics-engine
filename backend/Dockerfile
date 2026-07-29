FROM node:20-alpine

WORKDIR /app/backend

# This file used to `apk add openssl`, `COPY prisma ./prisma/` and `RUN npm run
# prisma:generate`. All three were left behind when the storage layer was deleted: there is
# no prisma/ directory and no prisma:generate script any more, so `docker build` failed on
# the COPY before it reached anything else — the documented deploy command
# (`docker compose -f docker-compose.prod.yml up -d --build`) could not produce an image at
# all. Nothing caught it because no CI job built this file; the image build+smoke job in
# .github/workflows/ci.yml is what keeps that from happening again.

# Manifests first so the dependency layer is only invalidated by a lockfile change rather
# than by every source edit.
COPY backend/package.json backend/package-lock.json ./

# --omit=dev: the only devDependency is supertest, which exists for the test suite. Test
# tooling in a production image is dead weight and extra attack surface, and the audit gate
# in CI already scopes itself the same way (`npm audit --omit=dev`).
RUN npm ci --omit=dev

COPY backend ./

# Drop root. Everything under /app is build output, so a single chown is enough.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Liveness, not readiness: this drives container restarts, and /live touches no
# dependencies. A deep check here would let a ten-second Redis blip restart the engine.
# docker-compose.prod.yml overrides this healthcheck and spells out the full reasoning.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec the start script directly rather than via `npm run start`. npm would sit between
# PID 1 and the script (npm -> sh -> node), and neither npm nor the shell reliably
# forwards SIGTERM, so scripts/start.mjs — which exists to forward that signal so the
# server can shut down gracefully — would never receive it. Docker would then SIGKILL
# the whole tree at the end of stop_grace_period, cutting in-flight requests.
CMD ["node", "scripts/start.mjs"]
