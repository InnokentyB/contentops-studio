FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS checks
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/planner
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
USER 1000:1000
WORKDIR /workspace
CMD ["node", "--test", "tests/tdpd/runtime-policy-collector.test.cjs", "tests/tdpd/runtime-policy-gate.test.cjs"]

FROM checks AS buildcheck
USER root
WORKDIR /opt/planner
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 prisma ./prisma
COPY --chown=1000:1000 frontend ./frontend
COPY --chown=1000:1000 tsconfig.json prisma.config.ts ./
RUN mkdir -p node_modules/.prisma dist frontend/node_modules/.vite-temp \
    && chown 1000:1000 /opt/planner node_modules node_modules/.prisma node_modules/@prisma/engines node_modules/@prisma/client dist frontend frontend/node_modules frontend/node_modules/.vite-temp
USER 1000:1000
RUN DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/synthetic npm run build:backend \
    && npm run build --prefix frontend
CMD ["node", "-e", "console.log('Backend/frontend build verified; no app started')"]
