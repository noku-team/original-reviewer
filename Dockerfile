# bun 1.3 + git (clone/diff/graph ref) + graphify AST. Secrets via env, never baked in.
FROM oven/bun:1.3.10 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.10
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv
ENV UV_TOOL_BIN_DIR=/usr/local/bin UV_TOOL_DIR=/opt/uv-tools UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv tool install graphifyy==0.9.79
RUN chmod -R a+rX /opt/uv-tools /opt/uv-python

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY docs/reviewer/SKILL.md ./docs/reviewer/SKILL.md

RUN useradd --uid 10001 --home /app --shell /usr/sbin/nologin app \
  && chown -R app:app /app
USER 10001

ENV PORT=3000 NODE_ENV=production GIT_TERMINAL_PROMPT=0
EXPOSE 3000
CMD ["bun", "src/server.ts"]
