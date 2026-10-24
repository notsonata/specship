ARG NODE_IMAGE=node:24-bookworm
ARG INSTANCE_IMAGE
FROM ${NODE_IMAGE} AS tools
ARG CODEX_VERSION
ARG OPENCODE_VERSION
RUN npm install -g @openai/codex@${CODEX_VERSION} opencode-ai@${OPENCODE_VERSION}
WORKDIR /opt/specship
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY .agents/skills ./.agents/skills
COPY scripts/benchmark ./scripts/benchmark

FROM ${INSTANCE_IMAGE}
USER root
COPY --from=tools /usr/local /usr/local
COPY --from=tools /opt/specship /opt/specship
RUN mkdir -p /root/.codex /root/.local/share/opencode
ENV CODEX_HOME=/root/.codex
WORKDIR /testbed
ENTRYPOINT ["/usr/local/bin/node", "/opt/specship/scripts/benchmark/agent.mjs"]
