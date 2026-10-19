# Test-only composition of reviewed infrastructure images; no credential or session.
FROM planner-policy-build-check:node24@sha256:15a6947d690a6421e8f1e2c92eb1a03d93f8d0db2872dccc78aa627f65dd595b AS dependencies
FROM tower-browser-checks:20261016@sha256:06f5297407da27a070a6d1a2deec79003a2977b8aa037a64e2132116f97dc227
USER root
WORKDIR /workspace
COPY --from=dependencies --chown=1000:1000 /opt/planner/node_modules ./node_modules
COPY --from=dependencies --chown=1000:1000 /opt/planner/frontend/node_modules ./frontend/node_modules
COPY --from=dependencies /opt/planner/package-lock.json /tmp/dependency-lock.json
COPY --from=dependencies /opt/planner/frontend/package-lock.json /tmp/frontend-dependency-lock.json
COPY --chown=1000:1000 package.json package-lock.json tsconfig.json prisma.config.ts AGENTS.md .env.example ./
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 tests ./tests
COPY --chown=1000:1000 scripts ./scripts
COPY --chown=1000:1000 prisma ./prisma
COPY --chown=1000:1000 frontend ./frontend
COPY --chown=1000:1000 docs ./docs
COPY --chown=1000:1000 ops ./ops
COPY --chown=1000:1000 .agents ./.agents
COPY --chown=1000:1000 .github ./.github
RUN cmp package-lock.json /tmp/dependency-lock.json && cmp frontend/package-lock.json /tmp/frontend-dependency-lock.json \
 && mkdir -p logs dist node_modules/.prisma frontend/node_modules/.vite-temp \
 && chown -R 1000:1000 logs dist node_modules/.prisma node_modules/@prisma/engines node_modules/@prisma/client frontend/node_modules/.vite-temp
USER 1000:1000
ENV HOME=/tmp/home PUPPETEER_SKIP_DOWNLOAD=true PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
CMD ["node", "--test", "tests/tdpd/vk-shared-browser.test.cjs"]
